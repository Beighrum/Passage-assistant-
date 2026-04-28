/**
 * Local, long-running reindex runner (not for Vercel time limits).
 *
 * Usage:
 *   npm run reindex:local
 *
 * Requires the same env vars as /api/reindex.
 */
import "dotenv/config";
import { indexDriveFolderIncremental, type IndexCursor } from "../api/lib/indexDrive.js";
import { mustGetEnv } from "../api/lib/ragEnv.js";

async function main() {
  const rootFolderId = mustGetEnv("PASSAGE_DRIVE_ROOT_FOLDER_ID");
  const modifiedSinceISO = process.env.MODIFIED_SINCE_ISO || "2021-01-01T00:00:00Z";

  let cursor: IndexCursor | undefined = undefined;
  let total = 0;

  for (;;) {
    const r = await indexDriveFolderIncremental({
      rootFolderId,
      modifiedSinceISO,
      cursor,
      maxFilesPerRun: 200,
      timeBudgetMs: 10 * 60 * 1000,
    });
    total += r.indexed;
    console.log(`[reindex] indexed=${r.indexed} total=${total} cursor=${r.nextCursor ? "yes" : "no"}`);
    cursor = r.nextCursor;
    if (!cursor) break;
  }

  console.log(`[reindex] complete total=${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

