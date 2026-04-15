import { buildSetTokenCookie } from '../_lib/cookies';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method Not Allowed');
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const accessToken = String(body?.accessToken || '').trim();
    if (!accessToken) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'No access token provided' }));
      return;
    }

    res.statusCode = 200;
    res.setHeader('Set-Cookie', buildSetTokenCookie(accessToken, 60 * 60)); // 1 hour
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true }));
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e?.message || 'Unknown error' }));
  }
}

