import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';

export const adsRouter = Router();

// GET /api/ads -- public. Only active banners; the homepage decides
// separately (via SiteSettings.adsEnabled) whether to render the column at
// all, so this doesn't need to know about that flag.
adsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const banners = await prisma.adBanner.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ banners });
  })
);

// GET /api/ads/all -- admin, every banner regardless of active state.
adsRouter.get(
  '/all',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const banners = await prisma.adBanner.findMany({
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ banners });
  })
);

const createSchema = z.object({
  title: z.string().trim().min(1).nullable().optional(),
  imageUrl: z.string().url(),
  linkUrl: z.string().url(),
  displayOrder: z.coerce.number().int().optional(),
});

adsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const banner = await prisma.adBanner.create({
      data: {
        title: data.title || null,
        imageUrl: data.imageUrl,
        linkUrl: data.linkUrl,
        displayOrder: data.displayOrder ?? 0,
      },
    });
    res.status(201).json({ banner });
  })
);

const updateSchema = z.object({
  title: z.string().trim().min(1).nullable().optional(),
  imageUrl: z.string().url().optional(),
  linkUrl: z.string().url().optional(),
  displayOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

adsRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = BigInt(req.params.id);
    const existing = await prisma.adBanner.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Ad banner not found');

    const data = updateSchema.parse(req.body);
    const banner = await prisma.adBanner.update({ where: { id }, data });
    res.json({ banner });
  })
);

adsRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = BigInt(req.params.id);
    const existing = await prisma.adBanner.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Ad banner not found');

    await prisma.adBanner.delete({ where: { id } });
    res.status(204).send();
  })
);
