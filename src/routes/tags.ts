import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';
import { paginatedArticlesForRelation } from '../lib/paginate-articles';

export const tagsRouter = Router();

tagsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const tags = await prisma.tag.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, _count: { select: { articleTags: true } } },
    });
    res.json({ tags: tags.map((t) => ({ ...t, articleCount: t._count.articleTags, _count: undefined })) });
  })
);

tagsRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const tag = await prisma.tag.findUnique({ where: { slug: req.params.slug } });
    if (!tag) throw new HttpError(404, 'Tag not found');

    const result = await paginatedArticlesForRelation({ articleTags: { some: { tagId: tag.id } } }, req.query);
    res.json({ tag, ...result });
  })
);

const tagWriteSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
});

tagsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tag = await prisma.tag.create({ data: tagWriteSchema.parse(req.body) });
    res.status(201).json({ tag });
  })
);

tagsRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.tag.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  })
);
