import { getCookieHeaderFromReq, getTokenFromCookieHeader } from '../lib/cookies.js';
import { extractDriveFileText } from '../lib/driveText.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('Method Not Allowed');
    return;
  }

  try {
    const token = getTokenFromCookieHeader(
      getCookieHeaderFromReq(req),
      process.env.SESSION_SECRET
    );
    if (!token) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Not authenticated' }));
      return;
    }

    const q = req.query || {};
    const fileId = String(q?.fileId ?? '').trim();
    if (!fileId) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing fileId' }));
      return;
    }

    const out = await extractDriveFileText(token, fileId);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(out));
  } catch (e: any) {
    console.error('[drive/file-text]', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({ error: e?.message || 'Failed to read file as text' })
    );
  }
}
