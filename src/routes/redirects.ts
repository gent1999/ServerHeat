import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';

export const redirectsRouter = Router();

// GET /api/redirects/lookup?path=/old-slug -- used by the frontend's
// middleware to 301 legacy WordPress URLs (old slugs, ?p=<id> links) to
// their current article path.
redirectsRouter.get(
  '/lookup',
  asyncHandler(async (req, res) => {
    const path = z.string().min(1).parse(req.query.path);
    const redirect = await prisma.redirect.findUnique({ where: { fromPath: path } });
    if (!redirect) throw new HttpError(404, 'No redirect for this path');
    res.json({ redirect });
  })
);

const redirectWriteSchema = z.object({
  fromPath: z.string().min(1),
  toPath: z.string().min(1),
  statusCode: z.number().int().default(301),
});

redirectsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const redirect = await prisma.redirect.create({ data: redirectWriteSchema.parse(req.body) });
    res.status(201).json({ redirect });
  })
);

redirectsRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.redirect.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  })
);
