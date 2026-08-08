import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/error-handler';
import { articleCardSelect } from '../lib/selections';

export const homeRouter = Router();

const homeQuerySchema = z.object({
  featuredCount: z.coerce.number().int().min(1).max(12).default(4),
  categoryCount: z.coerce.number().int().min(1).max(12).default(6),
  articlesPerCategory: z.coerce.number().int().min(1).max(12).default(4),
});

// GET /api/home -- one round trip for the whole landing page: a featured
// rail (curated via admin, falling back to the most recent published
// articles until anything is actually marked featured) plus, for each of
// the site's biggest categories, its latest few articles.
homeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = homeQuerySchema.parse(req.query);

    let featured = await prisma.article.findMany({
      where: { status: 'published', isFeatured: true },
      select: articleCardSelect,
      orderBy: [{ featuredOrder: 'asc' }, { publishedAt: 'desc' }],
      take: query.featuredCount,
    });

    if (featured.length === 0) {
      featured = await prisma.article.findMany({
        where: { status: 'published' },
        select: articleCardSelect,
        orderBy: { publishedAt: 'desc' },
        take: query.featuredCount,
      });
    }
    const featuredIds = new Set(featured.map((a) => a.id));

    const topCategories = await prisma.category.findMany({
      orderBy: { articleCategories: { _count: 'desc' } },
      take: query.categoryCount,
      select: { id: true, name: true, slug: true },
    });

    const sections = await Promise.all(
      topCategories.map(async (category) => {
        const articles = await prisma.article.findMany({
          where: {
            status: 'published',
            id: { notIn: [...featuredIds] },
            articleCategories: { some: { categoryId: category.id } },
          },
          select: articleCardSelect,
          orderBy: { publishedAt: 'desc' },
          take: query.articlesPerCategory,
        });
        return { category, articles };
      })
    );

    res.json({
      featured,
      sections: sections.filter((s) => s.articles.length > 0),
    });
  })
);
