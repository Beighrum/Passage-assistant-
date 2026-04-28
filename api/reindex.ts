import { indexDriveFolderIncremental, type IndexCursor } from "./lib/indexDrive.js";
import { mustGetEnv } from "./lib/ragEnv.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Required
    const rootFolderId = String(req.body?.rootFolderId || mustGetEnv("PASSAGE_DRIVE_ROOT_FOLDER_ID"));
    const modifiedSinceISO =
      String(req.body?.modifiedSinceISO || "2021-01-01T00:00:00Z");

    const cursor = (req.body?.cursor || undefined) as IndexCursor | undefined;
    const maxFilesPerRun = req.body?.maxFilesPerRun ? Number(req.body.maxFilesPerRun) : undefined;
    const timeBudgetMs = req.body?.timeBudgetMs ? Number(req.body.timeBudgetMs) : undefined;

    const r = await indexDriveFolderIncremental({
      rootFolderId,
      modifiedSinceISO,
      cursor,
      maxFilesPerRun,
      timeBudgetMs,
    });

    return res.status(200).json({
      ok: true,
      indexed: r.indexed,
      nextCursor: r.nextCursor || null,
      note:
        "Reindex is incremental. Call again with nextCursor until it returns null.",
    });
  } catch (e: any) {
    console.error("[reindex] failed:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Indexing failed" });
  }
}

