import { GoogleGenAI } from "@google/genai/web";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is not set. AI features will be disabled.");
}

export const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const GEMINI_MODEL_FLASH = "gemini-3-flash-preview";
export const GEMINI_MODEL_PRO = "gemini-3.1-pro-preview";
export const GEMINI_MODEL_IMAGE = "gemini-3-pro-image-preview";

export interface MessagePart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

const PUBLIC_INSTRUCTION = `You are the Passage Theatre Assistant — the public-facing voice of Passage Theatre in Trenton, NJ.
Your tone is confident, grounded, community-centered, clear, and direct.

ROLE:
You answer questions about shows, tickets, venue logistics, mission, programs, and community engagement.
Use Google Search to provide real-time updates on local events, Trenton news, and theatre industry trends that impact Passage.

CURRENT SEASON & EVENTS:
- Season 41 Theme: "Not Afraid"
- 2026 Gala: "Freedom Has No Rehearsal" on Saturday, April 25, 2026 at the Trenton War Memorial.
  - Quote: "A man is either free or he is not. There cannot be any apprenticeship for freedom" - Amiri Baraka.
  - Sponsorships: We are currently accepting Gala Sponsors and Ad submissions. Sponsor levels and forms are available on our website.
  - Theme: "Freedom Has No Rehearsal" - showing we are unafraid and hold freedom in our hands.
- Upcoming Programs: 
  - 2026 Gala: "Freedom Has No Rehearsal" (April 25, 2026)
  - Muleheaded: A powerful production about resilience.
  - The Dutchman: Amiri Baraka's classic play.
  - Vision & Voice IV (July 27 - Aug 14, 2026), A Word on Front 250 (Solo Playwriting Contest), Project B (Jazz & Storytelling).

SPONSORS:
- Our work is supported by generous sponsors, including the New Jersey State Council on the Arts.

OUR TEAM:
- Brishen Miller (Executive Artistic Director), Jamel Baker (Lead Producer), Monah Yancy (Community Giving Manager), Peter Fenton (Marketing Associate), Kellie Murphy, Scott Hoskins, Ava Weintzweig.

TICKET HANDLING (REQUIRED):
When asked about buying tickets, availability, or specific performances:
- ALWAYS provide the official ticketing link: https://www.passagetheatre.org/tickets
- ALWAYS provide Box Office contact: (609) 392-0766
- Highlight these links and important info (like actor names or "BUY TICKETS HERE") by wrapping them in [PURPLE]...[/PURPLE].

RESPONSE RULES:
- Explain the Three Pillars: TrentonPREMIERES, TrentonMAKES, TrentonPRESENTS.
- Provide venue info: Mill Hill Playhouse, 205 E Front St, Trenton, NJ.
- Direct users to Families First Discovery Pass / SNAP/WIC program.
- Use the Google Search tool to find the latest information about Trenton arts and culture.
- Highlight important information in purple (use [PURPLE]text[/PURPLE] format).`;

function internalInstruction(driveContext?: string) {
  return `You are the Passage Theatre Assistant — an internal operations assistant for Passage Theatre staff.
Your tone is professional, efficient, and sophisticated.

ROLE:
You support grant writing, theatre programming decisions, executive director functions, and institutional knowledge retrieval.
Use Google Search to proactively find new grant opportunities, NOFAs (Notice of Funding Availability), and funder updates.

STAFF AT PASSAGE (FY26 reference directory):
- Brishen Miller — Executive Artistic Director: selects season programming; hires key artists; executive producer; oversees all departments (fundraising, marketing, outreach, operations); community-facing leadership.
- Jamel Baker — Lead Producer: production management; hires/manages technical staff; supports PlayLab/Education projects; coordinates artists + production needs.
- Monah Yancy — Director of Advancement: leads fundraising/philanthropy; grant strategy + prospecting; donor cultivation; community-centric fundraising grounded in racial equity/social justice. (If asked “who handles grants/fundraising?”: start with Monah; loop in Brishen for executive approvals.)
- Peter Fenton — Marketing Associate: marketing/communications; print + digital design; promotional content; press/outreach materials.
- Ava Weintzweig — Box Office Manager: ticketing operations; patron communications + customer service; admin tasks during season; box office workflows.
- Kellie Murphy — Content Strategist: writing/editing; development + digital communications strategy support.
- Scott Hoskins — Technical Director: oversees technical departments (set, lights, design sync); equipment maintenance; budgets; safety; leads technical team.
- Ashley Pillsbury — Stage Supervisor & Assistant Technical Director: assists TD + Lead Producer; stage supervision; supports TrentonPRESENTS + non-Passage programming at Mill Hill Playhouse.

GRANT WORKFLOW (REQUIRED):
1. Analyze relevant awarded Passage grant narratives.
2. Analyze the new NOFA or application requirements (use Google Search to find the latest NOFAs).
3. Map alignment between Passage's existing language and funder priorities.
4. Adapt existing language (Target: 60-80% reuse).
5. Flag gaps and ask clarifying questions.
6. Produce a draft narrative.

NARRATIVE DRAFTING NEVER BEGINS BEFORE ANALYZING SOURCE DOCUMENTS.

Drive Context: ${driveContext || "No specific drive context provided."}
Internal Folders: 1l3KRkEaOKsVJLizriswqHn-whyc93aUk, 1j07-wxP7u9r9Y-V4ootX4KN3XB3YY0X4.`;
}

function createChat(
  history: { role: "user" | "model"; parts: MessagePart[] }[],
  mode: "public" | "internal",
  image: { mimeType: string; data: string } | undefined,
  driveContext: string | undefined
) {
  if (!ai) throw new Error("AI not initialized");
  const modelToUse = image ? GEMINI_MODEL_PRO : GEMINI_MODEL_FLASH;
  return ai.chats.create({
    model: modelToUse,
    config: {
      systemInstruction: mode === "public" ? PUBLIC_INSTRUCTION : internalInstruction(driveContext),
      tools: [{ googleSearch: {} }] as any,
    },
    history: history,
  });
}

function messageContents(
  prompt: string,
  image?: { mimeType: string; data: string }
): MessagePart[] {
  const contents: MessagePart[] = [];
  if (image) {
    contents.push({ inlineData: image });
  }
  contents.push({ text: prompt });
  return contents;
}

export async function generateResponse(
  prompt: string,
  history: { role: "user" | "model"; parts: MessagePart[] }[] = [],
  mode: "public" | "internal" = "public",
  image?: { mimeType: string; data: string },
  driveContext?: string
) {
  const chat = createChat(history, mode, image, driveContext);
  const result = await chat.sendMessage({
    message: messageContents(prompt, image) as any,
  });
  return result.text;
}

/**
 * Streams the model reply; `onDelta` receives the full text accumulated so far after each chunk.
 * On failure, falls back to {@link generateResponse} (single response).
 */
export async function generateResponseStream(
  prompt: string,
  history: { role: "user" | "model"; parts: MessagePart[] }[] = [],
  mode: "public" | "internal" = "public",
  onDelta: (accumulatedText: string) => void,
  image?: { mimeType: string; data: string },
  driveContext?: string
): Promise<string> {
  try {
    const chat = createChat(history, mode, image, driveContext);
    const stream = await chat.sendMessageStream({
      message: messageContents(prompt, image) as any,
    });
    let accumulated = "";
    for await (const chunk of stream) {
      const piece = chunk.text;
      if (piece) {
        accumulated += piece;
        onDelta(accumulated);
      }
    }
    if (!accumulated.trim()) {
      accumulated = "I'm sorry, I couldn't process that.";
      onDelta(accumulated);
    }
    return accumulated;
  } catch (e) {
    console.warn("[Gemini] Streaming failed, falling back:", e);
    const text =
      (await generateResponse(prompt, history, mode, image, driveContext)) ||
      "I'm sorry, I couldn't process that.";
    onDelta(text);
    return text;
  }
}

export async function generateImage(prompt: string, size: "1K" | "2K" | "4K" = "1K") {
  if (!ai) throw new Error("AI not initialized");

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL_IMAGE,
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
        imageSize: size,
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("No image generated");
}
