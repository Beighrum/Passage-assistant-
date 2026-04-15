import { getTokenFromCookieHeader } from '../_lib/cookies';

export default async function handler(req: any, res: any) {
  try {
    const token = getTokenFromCookieHeader(req.headers?.cookie);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ isAuthenticated: !!token }));
  } catch (e: any) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ isAuthenticated: false }));
  }
}

