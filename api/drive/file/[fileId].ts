import { google } from 'googleapis';
import { getCookieHeaderFromReq, getTokenFromCookieHeader } from '../../lib/cookies.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('Method Not Allowed');
    return;
  }

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

  try {
    const fileId = String(req.query?.fileId || '').trim();
    if (!fileId) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing fileId' }));
      return;
    }

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    client.setCredentials({ access_token: token });
    const drive = google.drive({ version: 'v3', auth: client });

    const response = await drive.files.get({
      fileId,
      alt: 'media',
    });

    res.statusCode = 200;
    res.end(response.data);
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e?.message || 'Failed to fetch file content' }));
  }
}

