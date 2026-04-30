/**
 * Institutional facts for Internal mode (/api/chat + Claude).
 * Mirrored from src/lib/gemini.ts internalInstruction — kept server-side so RAG chat always has baseline Passage knowledge even when vector retrieval returns nothing.
 */
export const INTERNAL_PASSAGE_INSTITUTIONAL = `
PASSAGE THEATRE — INSTITUTIONAL FACTS (use these even when SOURCES below are empty or unrelated):

ORGANIZATION:
- Passage Theatre Company is a professional theatre in Trenton, New Jersey (Mercer County).
- Venue: Mill Hill Playhouse, 205 E Front St, Trenton, NJ.

THREE PILLARS:
- TrentonPREMIERES — new-play development & premieres (including TrentonPREMIERES program language staff may cite).
- TrentonMAKES — community-centered creation & engagement programs.
- TrentonPRESENTS — presenting/partnership programming at Mill Hill Playhouse.

KEY STAFF (FY26-style directory — titles matter):
- Brishen Miller — Executive Artistic Director: season programming; hires key artists; executive producer; oversees fundraising, marketing, outreach, operations; community-facing leadership.
- Jamel Baker — Lead Producer: production management; technical staff; PlayLab/Education support.
- Monah Yancy — Director of Advancement: fundraising & philanthropy; grant strategy; donor cultivation (often first contact for grants; executive approvals may involve Brishen).
- Peter Fenton — Marketing Associate: marketing/communications; design; press/outreach materials.
- Ava Weintzweig — Box Office Manager: ticketing; patron communications.
- Kellie Murphy — Content Strategist: writing/editing; development & digital communications support.
- Scott Hoskins — Technical Director: technical departments (set, lights); equipment; budgets; safety.
- Ashley Pillsbury — Stage Supervisor & Assistant Technical Director: assists TD & Lead Producer.

RESPONSE STYLE:
- When SOURCES disagree with this baseline, prefer SOURCES for Drive/file-specific facts but never erase accurate institutional facts above (people, pillars, venue).
- For vague names ("brishen", "Brished"): infer likely Brishen Miller / ED role when context fits Passage staff.
`.trim();
