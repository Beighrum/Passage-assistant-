import type { drive_v3 } from "googleapis";
import { createDriveClient } from "./driveServiceAccount.js";
import { crawlDriveFolder } from "./driveCrawler.js";
import { extractTextFromDriveFile } from "./driveExtract.js";
import { chunkText } from "./chunkText.js";
import { embedDocuments } from "./voyageEmbeddings.js";
import { deleteChunksForDriveFile, upsertChunks, upsertDocument } from "./supabaseRag.js";

export type IndexCursor = {
  folderQueue: string[];
  pageToken?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, opts?: { tries?: number; baseMs?: number }) {
  const tries = opts?.tries ?? 4;
  const baseMs = opts?.baseMs ?? 600;
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const jitter = Math.floor(Math.random() * 250);
      await sleep(baseMs * Math.pow(2, i) + jitter);
    }
  }
  throw lastErr;
}

function toIntOrNull(v?: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function indexDriveFolderIncremental(opts: {
  rootFolderId: string;
  modifiedSinceISO: string;
  cursor?: IndexCursor;
  maxFilesPerRun?: number;
  timeBudgetMs?: number;
}): Promise<{ indexed: number; nextCursor?: IndexCursor }> {
  const drive = createDriveClient();
  const started = Date.now();
  const timeBudgetMs = opts.timeBudgetMs ?? 45_000;

  const { files, next } = await withRetry(() =>
    crawlDriveFolder(
      drive,
      {
        rootFolderId: opts.rootFolderId,
        modifiedSinceISO: opts.modifiedSinceISO,
        includeAllDrives: true,
        maxFiles: opts.maxFilesPerRun ?? 60,
      },
      opts.cursor
    )
  );

  let indexed = 0;

  for (const f of files) {
    if (Date.now() - started > timeBudgetMs) {
      return { indexed, nextCursor: next || opts.cursor };
    }

    // Skip folders (crawler includes them so we can recurse)
    if (f.mimeType === "application/vnd.google-apps.folder") continue;

    const extracted = await withRetry(() => extractTextFromDriveFile(drive as unknown as drive_v3.Drive, f), {
      tries: 3,
      baseMs: 800,
    });

    // Store doc metadata even if unsupported; chunks only if we have text.
    const docRow = await withRetry(() =>
      upsertDocument({
        drive_file_id: f.id,
        drive_web_view_link: f.webViewLink || null,
        name: f.name,
        mime_type: f.mimeType,
        modified_time: f.modifiedTime || null,
        checksum: f.md5Checksum || null,
        size_bytes: toIntOrNull(f.size),
        text_content: extracted.unsupported ? null : extracted.text,
      })
    );

    if (extracted.unsupported || !extracted.text?.trim()) {
      indexed++;
      continue;
    }

    const chunks = chunkText(extracted.text, { maxChars: 1400, overlapChars: 220 });
    if (chunks.length === 0) {
      indexed++;
      continue;
    }

    // Rebuild chunks for this file (simple + reliable). For large drives, we can diff by hash later.
    await withRetry(() => deleteChunksForDriveFile(f.id), { tries: 3, baseMs: 500 });

    // Embed in batches (Voyage supports arrays)
    const texts = chunks.map((c) => c.content);
    const embeddings = await withRetry(() => embedDocuments(texts), { tries: 4, baseMs: 900 });

    await withRetry(
      () =>
        upsertChunks(
          chunks.map((c, i) => ({
            document_id: docRow.id,
            drive_file_id: f.id,
            chunk_index: c.chunkIndex,
            content: c.content,
            content_hash: c.contentHash,
            embedding: embeddings[i]!,
            metadata: {
              name: f.name,
              mimeType: f.mimeType,
              modifiedTime: f.modifiedTime,
              truncated: extracted.truncated,
            },
          }))
        ),
      { tries: 3, baseMs: 800 }
    );

    indexed++;
  }

  return { indexed, nextCursor: next };
}

