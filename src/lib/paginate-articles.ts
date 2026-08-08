import { z } from 'zod';
import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import { articleCardSelect } from './selections';

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Shared "published articles matching some relation filter, paginated"
// query used by the category and tag detail routes.
export async function paginatedArticlesForRelation(extraWhere: Prisma.ArticleWhereInput, rawQuery: unknown) {
  const query = pageQuerySchema.parse(rawQuery);
  const where: Prisma.ArticleWhereInput = { status: 'published', ...extraWhere };

  const [total, articles] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.findMany({
      where,
      select: articleCardSelect,
      orderBy: { publishedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    articles,
    pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
  };
}
