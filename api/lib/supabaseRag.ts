import { createClient } from "@supabase/supabase-js";
import { mustGetEnv } from "./ragEnv.js";

export function supabaseAdmin() {
  const url = mustGetEnv("SUPABASE_URL");
  const key = mustGetEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export type UpsertDocumentInput = {
  drive_file_id: string;
  drive_web_view_link?: string | null;
  name: string;
  mime_type: string;
  modified_time?: string | null;
  checksum?: string | null;
  size_bytes?: number | null;
  text_content?: string | null;
};

export async function upsertDocument(doc: UpsertDocumentInput) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("passage_documents")
    .upsert(
      {
        ...doc,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "drive_file_id" }
    )
    .select("id, drive_file_id, name, modified_time, checksum")
    .single();
  if (error) throw error;
  return data as { id: string; drive_file_id: string; name: string };
}

export type UpsertChunkInput = {
  document_id: string;
  drive_file_id: string;
  chunk_index: number;
  content: string;
  content_hash: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
};

export async function upsertChunks(chunks: UpsertChunkInput[]) {
  if (chunks.length === 0) return;
  const sb = supabaseAdmin();
  const { error } = await sb.from("passage_chunks").insert(
    chunks.map((c) => ({
      ...c,
      metadata: c.metadata || {},
    }))
  );
  if (error) throw error;
}

export async function deleteChunksForDriveFile(driveFileId: string) {
  const sb = supabaseAdmin();
  const { error } = await sb.from("passage_chunks").delete().eq("drive_file_id", driveFileId);
  if (error) throw error;
}

export async function matchChunks(queryEmbedding: number[], opts?: { count?: number; threshold?: number }) {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("match_passage_chunks", {
    query_embedding: queryEmbedding,
    match_count: opts?.count ?? 8,
    match_threshold: opts?.threshold ?? 0.72,
  });
  if (error) throw error;
  return (data || []) as Array<{
    chunk_id: string;
    document_id: string;
    drive_file_id: string;
    name: string;
    drive_web_view_link: string | null;
    chunk_index: number;
    content: string;
    similarity: number;
    metadata: any;
  }>;
}

