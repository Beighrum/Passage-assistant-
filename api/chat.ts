import { embedQuery } from "./lib/voyageEmbeddings.js";
import { matchChunks } from "./lib/supabaseRag.js";
import { mustGetEnv, getOptionalEnv } from "./lib/ragEnv.js";

type ChatTurn = { role: "user" | "assistant"; content: string };

async function callClaude(opts: { system: string; messages: ChatTurn[] }) {
  const apiKey = mustGetEnv("ANTHROPIC_API_KEY");
  const model = getOptionalEnv("ANTHROPIC_MODEL") || "claude-sonnet-4-6";

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Claude API failed (${resp.status}): ${t}`);
  }
  const data = await resp.json();
  const text =
    Array.isArray(data?.content) && data.content[0]?.type === "text"
      ? data.content[0].text
      : "";
  return text as string;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Missing message" });

    const history = (req.body?.history || []) as Array<{ role: string; content: string }>;
    const queryEmbedding = await embedQuery(message);
    const matches = await matchChunks(queryEmbedding, {
      count: Number(req.body?.topK || 8),
      threshold: Number(req.body?.threshold || 0.72),
    });

    const citations = matches.map((m, i) => ({
      n: i + 1,
      name: m.name,
      url: m.drive_web_view_link,
      drive_file_id: m.drive_file_id,
      chunk_id: m.chunk_id,
      similarity: m.similarity,
    }));

    const contextBlock =
      matches.length === 0
        ? "No Drive sources matched this query."
        : matches
            .map(
              (m, i) =>
                `SOURCE [${i + 1}]\nTitle: ${m.name}\nLink: ${m.drive_web_view_link || "(no link)"}\nExcerpt:\n${m.content}`
            )
            .join("\n\n---\n\n");

    const system = `You are the Passage Theatre Assistant.\n\nYou have access to a private Passage Theatre knowledge base (Google Drive) via the SOURCES provided.\n\nRULES:\n- Answer the user using the SOURCES when relevant.\n- When you use a SOURCE, cite it inline like: (Source [2]: Strategic Plan)\n- If the SOURCES do not contain the answer, say so plainly and do not invent citations.\n\nSOURCES:\n${contextBlock}`;

    const turns: ChatTurn[] = [];
    for (const t of history) {
      const role = t.role === "assistant" ? "assistant" : "user";
      const content = String(t.content || "");
      if (content.trim()) turns.push({ role, content });
    }
    turns.push({ role: "user", content: message });

    const text = await callClaude({ system, messages: turns.slice(-18) });

    return res.status(200).json({ text, citations });
  } catch (e: any) {
    console.error("[chat] failed:", e);
    return res.status(500).json({ error: e?.message || "Chat failed" });
  }
}

