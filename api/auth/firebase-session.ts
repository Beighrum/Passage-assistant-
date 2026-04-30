import { buildSetTokenCookie } from '../lib/cookies.js';

/** Keep cookie value under typical 4KB header limits */
const MAX_TOKEN_CHARS = 3500;

/** Only persist tokens that can call Drive API — avoids marking session “authenticated” with profile-only OAuth tokens (mobile step 1). */
async function accessTokenHasDriveReadonly(accessToken: string): Promise<boolean> {
  try {
    const url = `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`;
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) return false;
    const data = (await r.json()) as { scope?: string };
    const scope = typeof data.scope === 'string' ? data.scope : '';
    return /\bdrive\.readonly\b/.test(scope) || /\bauth\/drive\.readonly\b/.test(scope);
  } catch {
    return false;
  }
}

/**
 * Read JSON POST body on Vercel Node serverless (req may be IncomingMessage with
 * unparsed body, or body may already be set). Avoids `node:stream/consumers`,
 * which can fail when bundled for some runtimes.
 */
async function readJsonBody(req: any): Promise<Record<string, unknown>> {
  const b = req?.body;
  if (Buffer.isBuffer(b)) {
    try {
      return JSON.parse(b.toString('utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof b === 'string') {
    try {
      return b.trim() ? (JSON.parse(b) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (b != null && typeof b === 'object' && !Array.isArray(b)) {
    return b as Record<string, unknown>;
  }

  if (!req || typeof req.on !== 'function') {
    return {};
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method Not Allowed');
    return;
  }

  try {
    const body = await readJsonBody(req);
    const accessToken = String(body?.accessToken || '').trim();
    if (!accessToken) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'No access token provided' }));
      return;
    }
    if (accessToken.length > MAX_TOKEN_CHARS) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Access token too large for cookie storage',
        })
      );
      return;
    }

    const driveOk = await accessTokenHasDriveReadonly(accessToken);
    if (!driveOk) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Access token missing Google Drive read scope',
          code: 'MISSING_DRIVE_SCOPE',
        })
      );
      return;
    }

    const cookie = buildSetTokenCookie(
      accessToken,
      60 * 60 * 24 * 7,
      process.env.SESSION_SECRET
    );
    res.statusCode = 200;
    res.setHeader('Set-Cookie', cookie);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true }));
  } catch (e: any) {
    console.error('[api/auth/firebase-session]', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e?.message || 'Unknown error' }));
  }
}
