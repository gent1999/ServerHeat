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
