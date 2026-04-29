import "./nodePdfPolyfills.js";
import type { drive_v3 } from "googleapis";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export const EXTRACT_MAX_CHARS = 250_000;

export type ExtractedText = {
  text: string;
  truncated: boolean;
  unsupported?: boolean;
};

export async function extractTextFromDriveFile(
  drive: drive_v3.Drive,
  file: { id: string; mimeType: string; name?: string }
): Promise<ExtractedText> {
  const id = file.id;
  const mime = file.mimeType || "";

  let text = "";

  if (mime === "application/vnd.google-apps.document") {
    const exported = await drive.files.export(
      { fileId: id, mimeType: "text/plain" },
      { responseType: "arraybuffer" }
    );
    text = Buffer.from(exported.data as ArrayBuffer).toString("utf8");
  } else if (mime === "application/vnd.google-apps.spreadsheet") {
    const exported = await drive.files.export(
      { fileId: id, mimeType: "text/csv" },
      { responseType: "arraybuffer" }
    );
    text = Buffer.from(exported.data as ArrayBuffer).toString("utf8");
  } else if (mime === "application/vnd.google-apps.presentation") {
    const exported = await drive.files.export(
      { fileId: id, mimeType: "text/plain" },
      { responseType: "arraybuffer" }
    );
    text = Buffer.from(exported.data as ArrayBuffer).toString("utf8");
  } else if (mime.startsWith("text/") || mime === "application/json") {
    const media = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "arraybuffer" });
    text = Buffer.from(media.data as ArrayBuffer).toString("utf8");
  } else if (mime === "application/pdf") {
    try {
      const media = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "arraybuffer" });
      const buffer = Buffer.from(media.data as ArrayBuffer);
      const parser = new PDFParse({ data: buffer });
      try {
        const data = await parser.getText();
        text = data.text || "";
      } finally {
        await parser.destroy().catch(() => {});
      }
    } catch (err) {
      // pdf-parse/pdfjs worker issues should not stop indexing all other files.
      console.warn("[driveExtract] PDF parsing skipped:", file.name || id, err);
      return { text: "", truncated: false, unsupported: true };
    }
  } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const media = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "arraybuffer" });
    const buffer = Buffer.from(media.data as ArrayBuffer);
    const data = await mammoth.extractRawText({ buffer });
    text = data.value || "";
  } else {
    return { text: "", truncated: false, unsupported: true };
  }

  const truncated = text.length > EXTRACT_MAX_CHARS;
  if (truncated) text = text.slice(0, EXTRACT_MAX_CHARS) + "\n\n[Truncated]";

  return { text, truncated };
}

