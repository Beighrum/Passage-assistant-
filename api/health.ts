/** Minimal probe for Vercel serverless — no imports so it always loads. */
export default async function handler(_req: unknown, res: any) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, ts: Date.now() }));
}
