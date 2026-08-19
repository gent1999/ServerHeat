import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';

export const mediaRouter = Router();

const mediaWriteSchema = z.object({
  sourceUrl: z.string().url(),
  altText: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
});

// POST /api/media -- admin only. There's no file upload/storage wired up
// yet, so this just records a reference to an already-hosted image URL
// (matches how migrated articles' featured images work today).
mediaRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = mediaWriteSchema.parse(req.body);
    const media = await prisma.media.create({
      data: { sourceUrl: data.sourceUrl, altText: data.altText ?? null, mimeType: data.mimeType ?? null },
    });
    res.status(201).json({ media });
  })
);

const mediaUpdateSchema = z.object({
  sourceUrl: z.string().url().optional(),
  altText: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
});

// PATCH /api/media/:id -- admin only. Repoints an existing media record at a
// new sourceUrl (used to re-host migrated images without touching the
// articles that reference them).
mediaRouter.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = mediaUpdateSchema.parse(req.body);
    const media = await prisma.media.update({ where: { id }, data });
    res.json({ media });
  })
);
