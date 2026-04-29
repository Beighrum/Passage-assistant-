import type { drive_v3 } from "googleapis";

export type DriveFileLite = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  md5Checksum?: string;
  size?: string;
  parents?: string[];
};

export type CrawlOptions = {
  rootFolderId: string;
  modifiedSinceISO: string; // e.g. 2021-01-01T00:00:00Z
  // If true, uses allDrives parameters (recommended for org drives)
  includeAllDrives?: boolean;
  maxFiles?: number; // safety cap per run
  pageToken?: string; // continuation token (optional)
};

/**
 * Recursively lists all files under a Drive folder, filtered by modifiedTime >= modifiedSinceISO.
 * Returns both files and a continuation cursor (folder queue + page token) suitable for resuming.
 *
 * NOTE: Google Drive API doesn't support true recursive queries, so we BFS folders.
 */
export async function crawlDriveFolder(
  drive: drive_v3.Drive,
  opts: CrawlOptions,
  resume?: { folderQueue: string[]; pageToken?: string }
): Promise<{
  files: DriveFileLite[];
  next?: { folderQueue: string[]; pageToken?: string };
}> {
  const includeAllDrives = opts.includeAllDrives ?? true;
  const maxFiles = opts.maxFiles ?? 500;

  const folderQueue: string[] = resume?.folderQueue?.length
    ? [...resume.folderQueue]
    : [opts.rootFolderId];
  const queued = new Set(folderQueue);
  let pageToken: string | undefined = resume?.pageToken || opts.pageToken;

  const out: DriveFileLite[] = [];

  while (folderQueue.length) {
    const folderId = folderQueue[0]!;

    // List *direct children* of this folder.
    const q = [
      `'${folderId}' in parents`,
      "trashed = false",
      `modifiedTime >= '${opts.modifiedSinceISO}'`,
    ].join(" and ");

    const resp = await drive.files.list({
      q,
      fields:
        "nextPageToken, files(id,name,mimeType,modifiedTime,webViewLink,md5Checksum,size,parents)",
      pageSize: 200,
      pageToken,
      includeItemsFromAllDrives: includeAllDrives,
      supportsAllDrives: includeAllDrives,
      corpora: includeAllDrives ? "allDrives" : "user",
    });

    const files = (resp.data.files || []) as DriveFileLite[];
    for (const f of files) {
      out.push(f);
      if (f.mimeType === "application/vnd.google-apps.folder") {
        if (!queued.has(f.id)) {
          folderQueue.push(f.id);
          queued.add(f.id);
        }
      }
      if (out.length >= maxFiles) {
        const nextPage = resp.data.nextPageToken || undefined;
        // If we've exhausted the current folder page listing, advance to next folder
        // before returning cursor so we don't restart this same folder forever.
        if (!nextPage) {
          folderQueue.shift();
          pageToken = undefined;
        } else {
          pageToken = nextPage;
        }
        return { files: out, next: { folderQueue, pageToken } };
      }
    }

    pageToken = resp.data.nextPageToken || undefined;
    if (!pageToken) {
      // Finished this folder; move to next.
      folderQueue.shift();
    } else {
      // Continue same folder on next call.
      return { files: out, next: { folderQueue, pageToken } };
    }
  }

  return { files: out };
}

