import type { IndexCursor } from "./lib/indexDrive.js";
import { mustGetEnv } from "./lib/ragEnv.js";
import { readJsonBody } from "./lib/readJsonBody.js";

export default async function handler(req: any, res: any) {
  // Reject non-POST before loading Drive/pdf/googleapis (avoids GET crashes + heavy cold imports).
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { indexDriveFolderIncremental } = await import("./lib/indexDrive.js");

    const body = await readJsonBody(req);

    let rootFolderId = String(body.rootFolderId ?? "").trim();
    if (!rootFolderId) {
      try {
        rootFolderId = mustGetEnv("PASSAGE_DRIVE_ROOT_FOLDER_ID").trim();
      } catch {
        return res.status(400).json({
          ok: false,
          error:
            "Missing rootFolderId in JSON body and PASSAGE_DRIVE_ROOT_FOLDER_ID env var.",
        });
      }
    }

    const modifiedSinceISO = String(body.modifiedSinceISO || "2021-01-01T00:00:00Z");

    const cursor = (body.cursor || undefined) as IndexCursor | undefined;
    const maxFilesPerRun = body.maxFilesPerRun != null ? Number(body.maxFilesPerRun) : undefined;
    const timeBudgetMs = body.timeBudgetMs != null ? Number(body.timeBudgetMs) : undefined;

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
