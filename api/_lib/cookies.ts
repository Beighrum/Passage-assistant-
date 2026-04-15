const COOKIE_NAME = 'pt_drive_token';

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

