import { embedQuery } from "./lib/voyageEmbeddings.js";
import { matchChunks } from "./lib/supabaseRag.js";
import { mustGetEnv, getOptionalEnv } from "./lib/ragEnv.js";
import { INTERNAL_PASSAGE_INSTITUTIONAL } from "./lib/passageKnowledge.js";

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

async function callClaudeStream(opts: { system: string; messages: ChatTurn[] }) {
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
      stream: true,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Claude API failed (${resp.status}): ${t}`);
  }
  if (!resp.body) throw new Error("Claude stream has no body");
  return resp.body;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const wantStream = Boolean(req.body?.stream);
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Missing message" });

    const history = (req.body?.history || []) as Array<{ role: string; content: string }>;

    let matches: Awaited<ReturnType<typeof matchChunks>> = [];
    try {
      const queryEmbedding = await embedQuery(message);
      matches = await matchChunks(queryEmbedding, {
        count: Number(req.body?.topK || 8),
        threshold: Number(req.body?.threshold ?? 0.5),
      });
    } catch (ragErr) {
      console.error("[chat] RAG retrieval failed (continuing with institutional context only):", ragErr);
    }

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

    const system = `${INTERNAL_PASSAGE_INSTITUTIONAL}

You are the Passage Theatre Assistant for internal staff.

You also receive excerpts from a Supabase-indexed Google Drive corpus as SOURCES.

RULES:
- Use SOURCES when they contain relevant facts; cite inline like (Source [2]: Strategic Plan).
- When SOURCES are empty or off-topic BUT the question is answered by INSTITUTIONAL FACTS above, answer from those facts. Do not claim you have no information about Passage leadership or pillars if those facts apply.
- When neither SOURCES nor institutional facts suffice, say so plainly and do not invent citations.

SOURCES:
${contextBlock}`;

    const turns: ChatTurn[] = [];
    for (const t of history) {
      const role = t.role === "assistant" ? "assistant" : "user";
      const content = String(t.content || "");
      if (content.trim()) turns.push({ role, content });
    }
    turns.push({ role: "user", content: message });

    if (!wantStream) {
      const text = await callClaude({ system, messages: turns.slice(-18) });
      return res.status(200).json({ text, citations });
    }

    // Stream response as Server-Sent Events (SSE) so the client can render deltas.
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    // @ts-ignore
    res.flushHeaders?.();

    const body = await callClaudeStream({ system, messages: turns.slice(-18) });
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    const writeEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
    };

    /** JSON-encoded chunks so spaces/newlines inside deltas cannot break SSE framing; client must JSON.parse. */
    const writeDelta = (text: string) => {
      res.write(`event: delta\n`);
      res.write(`data: ${JSON.stringify(text)}\n\n`);
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Anthropic streams as SSE; parse line-by-line.
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trimEnd();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          if (!line.startsWith("data:")) continue;
          const payload = line.slice("data:".length).trim();
          if (!payload || payload === "[DONE]") continue;
          let json: any = null;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          // We forward only text deltas.
          if (json?.type === "content_block_delta" && json?.delta?.type === "text_delta") {
            const delta = String(json.delta.text || "");
            if (delta) writeDelta(delta);
          }
        }
      }

      // Send citations at the end so the UI can render them.
      writeEvent("citations", citations);
      writeEvent("done", "ok");
      res.end();
    } catch (e) {
      try {
        writeEvent("error", { message: (e as any)?.message || "Stream failed" });
      } catch {
        /* ignore */
      }
      res.end();
    }
  } catch (e: any) {
    console.error("[chat] failed:", e);
    return res.status(500).json({ error: e?.message || "Chat failed" });
  }
}

