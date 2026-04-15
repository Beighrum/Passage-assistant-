const COOKIE_NAME = 'pt_drive_token';

/** Vercel/Node may pass `cookie` as string or string[] in edge cases. */
export function getCookieHeaderFromReq(req: { headers?: { cookie?: string | string[] } } | null) {
  const c = req?.headers?.cookie;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.join('; ');
  return undefined;
}

export function getTokenFromCookieHeader(cookieHeader: string | undefined | null) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((p) => p.trim());
  for (const part of parts) {
    if (!part.startsWith(`${COOKIE_NAME}=`)) continue;
    const raw = part.slice(COOKIE_NAME.length + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function buildSetTokenCookie(token: string, maxAgeSeconds = 60 * 60) {
  // Lax is fine since we're same-site on Vercel; Secure required on https.
  const value = encodeURIComponent(token);
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function buildClearTokenCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

