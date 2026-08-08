import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';
import { paginatedArticlesForRelation } from '../lib/paginate-articles';

export const categoriesRouter = Router();

categoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        _count: { select: { articleCategories: true } },
      },
    });
    res.json({
      categories: categories.map((c) => ({ ...c, articleCount: c._count.articleCategories, _count: undefined })),
    });
  })
);

categoriesRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findUnique({ where: { slug: req.params.slug } });
    if (!category) throw new HttpError(404, 'Category not found');

    const result = await paginatedArticlesForRelation(
      { articleCategories: { some: { categoryId: category.id } } },
      req.query
    );

    res.json({ category, ...result });
  })
);

const categoryWriteSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().nullable().optional(),
});

categoriesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = categoryWriteSchema.parse(req.body);
    const category = await prisma.category.create({ data: { ...data, description: data.description ?? null } });
    res.status(201).json({ category });
  })
);

categoriesRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = categoryWriteSchema.partial().parse(req.body);
    const category = await prisma.category.update({ where: { id: Number(req.params.id) }, data });
    res.json({ category });
  })
);

categoriesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.category.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  })
);
