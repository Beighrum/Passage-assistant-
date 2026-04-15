import { google } from 'googleapis';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export const DRIVE_TEXT_MAX_CHARS = 120_000;

export async function extractDriveFileText(accessToken: string, fileId: string) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth: client });

  const meta = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType',
  });
  const name = meta.data.name || fileId;
  const mime = meta.data.mimeType || '';

  let text = '';

  if (mime === 'application/vnd.google-apps.document') {
    const exported = await drive.files.export(
      { fileId, mimeType: 'text/plain' },
      { responseType: 'arraybuffer' }
    );
    text = Buffer.from(exported.data as ArrayBuffer).toString('utf8');
  } else if (mime === 'application/vnd.google-apps.spreadsheet') {
    const exported = await drive.files.export(
      { fileId, mimeType: 'text/csv' },
      { responseType: 'arraybuffer' }
    );
    text = Buffer.from(exported.data as ArrayBuffer).toString('utf8');
  } else if (mime.startsWith('text/') || mime === 'application/json') {
    const media = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    text = Buffer.from(media.data as ArrayBuffer).toString('utf8');
  } else if (mime === 'application/pdf') {
    const media = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(media.data as ArrayBuffer);
    const parser = new PDFParse({ data: buffer });
    try {
      const data = await parser.getText();
      text = data.text || '';
    } finally {
      await parser.destroy().catch(() => {});
    }
  } else if (
    mime ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const media = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(media.data as ArrayBuffer);
    const data = await mammoth.extractRawText({ buffer });
    text = data.value || '';
  } else {
    return {
      name,
      mimeType: mime,
      text: `[File type not inlined for AI context (${mime || 'unknown'}). Use a Google Doc or plain text file, or paste an excerpt.]`,
      unsupported: true as const,
      truncated: false,
    };
  }

  const truncated = text.length > DRIVE_TEXT_MAX_CHARS;
  if (truncated) {
    text =
      text.slice(0, DRIVE_TEXT_MAX_CHARS) + '\n\n[Truncated for length]';
  }

  return { name, mimeType: mime, text, truncated };
}
