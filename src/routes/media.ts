import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';

export const mediaRouter = Router();

const CLOUDINARY_FOLDER = 'artistheat';

// POST /api/media/upload-signature -- admin only. Cloudinary's API secret
// never leaves the server: we sign a short-lived upload authorization here,
// and the browser uploads the file bytes straight to Cloudinary with it.
// That keeps large image uploads off Vercel's serverless request-body limit
// entirely (the file never passes through our function).
mediaRouter.post(
  '/upload-signature',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      res.status(503).json({ error: 'Image upload is not configured.' });
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = { folder: CLOUDINARY_FOLDER, timestamp };
    const toSign = Object.keys(paramsToSign)
      .sort()
      .map((key) => `${key}=${paramsToSign[key as keyof typeof paramsToSign]}`)
      .join('&');
    const signature = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');

    res.json({ cloudName, apiKey, timestamp, signature, folder: CLOUDINARY_FOLDER });
  })
);

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
