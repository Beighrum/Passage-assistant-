import crypto from "crypto";

export type TextChunk = {
  content: string;
  contentHash: string;
  chunkIndex: number;
};

export function chunkText(input: string, opts?: { maxChars?: number; overlapChars?: number }): TextChunk[] {
  const maxChars = opts?.maxChars ?? 1400;
  const overlap = opts?.overlapChars ?? 200;

  const text = (input || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const chunks: TextChunk[] = [];
  let i = 0;
  let idx = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + maxChars);
    const content = text.slice(i, end).trim();
    if (content) {
      const contentHash = crypto.createHash("sha256").update(content).digest("hex");
      chunks.push({ content, contentHash, chunkIndex: idx++ });
    }
    if (end >= text.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

