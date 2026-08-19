import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdminRole, AuthedRequest } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const admin = await prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      throw new HttpError(401, 'Invalid email or password');
    }

    const signOptions: jwt.SignOptions = {
      expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
    };
    const token = jwt.sign(
      { sub: Number(admin.id), email: admin.email, role: admin.role },
      process.env.JWT_SECRET as string,
      signOptions
    );

    res.json({
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin!.id } });
    if (!admin) throw new HttpError(404, 'Admin not found');
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
  })
);

const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['admin', 'editor']).default('editor'),
});

// POST /api/auth/admins -- full-admin only. Lets the primary admin create
// additional admin-panel accounts (e.g. a restricted "editor" role)
// without needing direct database access.
authRouter.post(
  '/admins',
  requireAuth,
  requireAdminRole,
  asyncHandler(async (req, res) => {
    const data = createAdminSchema.parse(req.body);

    const existing = await prisma.adminUser.findUnique({ where: { email: data.email } });
    if (existing) throw new HttpError(409, 'An admin with that email already exists');

    const passwordHash = await bcrypt.hash(data.password, 10);
    const admin = await prisma.adminUser.create({
      data: { email: data.email, passwordHash, name: data.name, role: data.role },
    });

    res.status(201).json({ admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
  })
);
