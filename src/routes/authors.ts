import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';
import { paginatedArticlesForRelation } from '../lib/paginate-articles';

export const authorsRouter = Router();

authorsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const authors = await prisma.author.findMany({ orderBy: { name: 'asc' } });
    res.json({ authors });
  })
);

authorsRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const author = await prisma.author.findUnique({ where: { slug: req.params.slug } });
    if (!author) throw new HttpError(404, 'Author not found');

    const result = await paginatedArticlesForRelation({ authorId: author.id }, req.query);
    res.json({ author, ...result });
  })
);

const authorWriteSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
});

// POST /api/authors -- admin only. Lets the article form create a byline
// on the fly by name rather than forcing a pick from a pre-existing list.
authorsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = authorWriteSchema.parse(req.body);
    const author = await prisma.author.create({ data });
    res.status(201).json({ author });
  })
);

const authorUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  bio: z.string().trim().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

// PUT /api/authors/:id -- admin only. Lets the admin Users page set a
// byline's profile picture (and touch up name/bio) without going through
// the article form's free-typed-name create flow.
authorsRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = BigInt(req.params.id);
    const existing = await prisma.author.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Author not found');

    const data = authorUpdateSchema.parse(req.body);
    const author = await prisma.author.update({ where: { id }, data });
    res.json({ author });
  })
);
