import { Router } from 'express';
import { prisma } from '../lib/prisma';
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
