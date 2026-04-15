import { buildClearTokenCookie } from '../_lib/cookies';

export default async function handler(req: any, res: any) {
  res.statusCode = 200;
  res.setHeader('Set-Cookie', buildClearTokenCookie());
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: true }));
}

