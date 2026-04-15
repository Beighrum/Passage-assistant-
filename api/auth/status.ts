import { getCookieHeaderFromReq, getTokenFromCookieHeader } from '../lib/cookies';

export default async function handler(req: any, res: any) {
  try {
    const token = getTokenFromCookieHeader(getCookieHeaderFromReq(req));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ isAuthenticated: !!token }));
  } catch {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ isAuthenticated: false }));
  }
}

