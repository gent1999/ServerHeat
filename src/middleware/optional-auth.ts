import { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthedRequest } from './auth';

// Like requireAuth, but never rejects -- just attaches req.admin when a
// valid token is present. Lets one endpoint (e.g. GET /articles) serve
// both the public site (no token) and the admin dashboard (token, sees
// drafts too) without duplicating the route.
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET as string) as unknown as {
        sub: number;
        email: string;
        role: string;
      };
      req.admin = { id: payload.sub, email: payload.email, role: payload.role };
    } catch {
      // ignore invalid token; treat as anonymous
    }
  }
  next();
}
