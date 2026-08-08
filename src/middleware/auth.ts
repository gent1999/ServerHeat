import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthedRequest extends Request {
  admin?: { id: number; email: string; role: string };
}

// Stateless bearer-token auth so any frontend (the Next.js admin panel
// today, other clients later) can authenticate the same way -- no
// cookie/session state lives on this server.
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as unknown as {
      sub: number;
      email: string;
      role: string;
    };
    req.admin = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
