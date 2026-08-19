import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdminRole, AuthedRequest } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';

export const authRouter = Router();

// Emails are matched case-insensitively everywhere in this file (login,
// create, update) -- real mail providers treat the local part as
// case-insensitive in practice, and "wrong case" shouldn't read as "wrong
// password" to someone logging in.
const emailSchema = z.string().email().transform((v) => v.toLowerCase());

const loginSchema = z.object({
  email: emailSchema,
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
  email: emailSchema,
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

// GET /api/auth/admins -- full-admin only. Powers the Users tab.
authRouter.get(
  '/admins',
  requireAuth,
  requireAdminRole,
  asyncHandler(async (_req, res) => {
    const admins = await prisma.adminUser.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ admins });
  })
);

const updateAdminSchema = z.object({
  email: emailSchema.optional(),
  name: z.string().min(1).optional(),
  role: z.enum(['admin', 'editor']).optional(),
  password: z.string().min(8).optional(),
});

// PATCH /api/auth/admins/:id -- full-admin only.
authRouter.patch(
  '/admins/:id',
  requireAuth,
  requireAdminRole,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = updateAdminSchema.parse(req.body);

    if (data.email) {
      const existing = await prisma.adminUser.findUnique({ where: { email: data.email } });
      if (existing && Number(existing.id) !== id) throw new HttpError(409, 'An admin with that email already exists');
    }

    // Demoting the last remaining full admin would lock everyone out of
    // account management -- refuse it, same as deleting the last admin.
    if (data.role === 'editor') {
      const adminCount = await prisma.adminUser.count({ where: { role: 'admin' } });
      const target = await prisma.adminUser.findUnique({ where: { id } });
      if (target?.role === 'admin' && adminCount <= 1) {
        throw new HttpError(400, 'At least one admin account must remain.');
      }
    }

    const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;

    const admin = await prisma.adminUser.update({
      where: { id },
      data: {
        ...(data.email !== undefined && { email: data.email }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.role !== undefined && { role: data.role }),
        ...(passwordHash !== undefined && { passwordHash }),
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    res.json({ admin });
  })
);

// DELETE /api/auth/admins/:id -- full-admin only. Can't delete your own
// account (avoids locking yourself out mid-session) or the last remaining
// admin account (avoids locking everyone out permanently).
authRouter.delete(
  '/admins/:id',
  requireAuth,
  requireAdminRole,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (id === req.admin!.id) {
      throw new HttpError(400, "You can't delete your own account while logged in as it.");
    }

    const target = await prisma.adminUser.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, 'Admin not found');

    if (target.role === 'admin') {
      const adminCount = await prisma.adminUser.count({ where: { role: 'admin' } });
      if (adminCount <= 1) throw new HttpError(400, 'At least one admin account must remain.');
    }

    await prisma.adminUser.delete({ where: { id } });
    res.status(204).send();
  })
);
