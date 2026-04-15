import { google } from 'googleapis';
import { getTokenFromCookieHeader } from '../_lib/cookies';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('Method Not Allowed');
    return;
  }

  const token = getTokenFromCookieHeader(req.headers?.cookie);
  if (!token) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not authenticated' }));
    return;
  }

  try {
    const folderId = String(req.query?.folderId || '').trim();

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    client.setCredentials({ access_token: token });
    const drive = google.drive({ version: 'v3', auth: client });

    const q = folderId ? `'${folderId}' in parents and trashed = false` : 'trashed = false';
    const response = await drive.files.list({
      q,
      pageSize: 20,
      fields: 'nextPageToken, files(id, name, mimeType, thumbnailLink, description)',
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response.data));
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e?.message || 'Failed to fetch files' }));
  }
}

