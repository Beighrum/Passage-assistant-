import { buildSetTokenCookie } from '../_lib/cookies';

/** Keep cookie value under typical 4KB header limits */
const MAX_TOKEN_CHARS = 3500;

function readJsonBody(req: any): Record<string, unknown> {
  const b = req?.body;
  if (b == null) return {};
  if (typeof b === 'string') {
    try {
      return JSON.parse(b) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof b === 'object') return b as Record<string, unknown>;
  return {};
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method Not Allowed');
    return;
  }

  try {
    const body = readJsonBody(req);
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

    const cookie = buildSetTokenCookie(accessToken, 60 * 60 * 24 * 7); // 7 days max-age (Google token may expire sooner)
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

