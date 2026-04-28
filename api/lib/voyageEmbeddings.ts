import { mustGetEnv, getOptionalEnv } from "./ragEnv.js";

type VoyageEmbedResponse = {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage?: { total_tokens: number };
};

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export function voyageModel(): string {
  return getOptionalEnv("VOYAGE_MODEL") || "voyage-4";
}

async function voyageEmbed(input: string[], inputType: "document" | "query") {
  const apiKey = mustGetEnv("VOYAGE_API_KEY");
  const resp = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input,
      model: voyageModel(),
      input_type: inputType,
    }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`Voyage embed failed (${resp.status}): ${msg}`);
  }
  return (await resp.json()) as VoyageEmbedResponse;
}

export async function embedQuery(query: string): Promise<number[]> {
  const r = await voyageEmbed([query], "query");
  const emb = r.data?.[0]?.embedding;
  if (!emb?.length) throw new Error("Voyage returned empty embedding");
  return emb;
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const r = await voyageEmbed(texts, "document");
  const out: number[][] = new Array(texts.length);
  for (const item of r.data || []) out[item.index] = item.embedding;
  if (out.some((v) => !v?.length)) throw new Error("Voyage returned missing embeddings");
  return out;
}

