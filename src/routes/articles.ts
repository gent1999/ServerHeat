import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { optionalAuth } from '../middleware/optional-auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';
import { articleCardSelect, articleDetailSelect } from '../lib/selections';

export const articlesRouter = Router();

const articleCard = articleCardSelect;
const articleDetail = articleDetailSelect;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().optional(),
  tag: z.string().optional(),
  status: z.enum(['draft', 'published', 'all']).optional(),
});

// GET /api/articles -- public list. Anonymous callers only ever see
// published articles; an authenticated admin can pass ?status= to see
// drafts too (used by the admin dashboard's article list).
articlesRouter.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const isAdmin = Boolean(req.admin);

    const where: Record<string, unknown> = {};
    if (!isAdmin) {
      where.status = 'published';
    } else if (query.status && query.status !== 'all') {
      where.status = query.status;
    }
    if (query.category) {
      where.articleCategories = { some: { category: { slug: query.category } } };
    }
    if (query.tag) {
      where.articleTags = { some: { tag: { slug: query.tag } } };
    }

    const [total, articles] = await Promise.all([
      prisma.article.count({ where }),
      prisma.article.findMany({
        where,
        select: articleCard,
        orderBy: { publishedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    res.json({
      articles,
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    });
  })
);

// GET /api/articles/:slug -- public detail. Drafts are only visible to
// an authenticated admin (lets the admin panel preview unpublished work).
articlesRouter.get(
  '/:slug',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const article = await prisma.article.findUnique({
      where: { slug: req.params.slug },
      select: articleDetail,
    });
    if (!article || (article.status !== 'published' && !req.admin)) {
      throw new HttpError(404, 'Article not found');
    }
    res.json({ article });
  })
);

const articleWriteSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'slug must be lowercase, numbers, and hyphens only'),
  excerpt: z.string().nullable().optional(),
  content: z.string().min(1),
  status: z.enum(['draft', 'published']).default('draft'),
  authorId: z.number().int().nullable().optional(),
  featuredImageId: z.number().int().nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  seoTitle: z.string().nullable().optional(),
  seoDescription: z.string().nullable().optional(),
  seoFocusKeyword: z.string().nullable().optional(),
  canonicalUrl: z.string().nullable().optional(),
  ogImageUrl: z.string().nullable().optional(),
  isFeatured: z.boolean().default(false),
  featuredOrder: z.number().int().nullable().optional(),
  categoryIds: z.array(z.number().int()).default([]),
  primaryCategoryId: z.number().int().nullable().optional(),
  tagIds: z.array(z.number().int()).default([]),
});

function categoryRelationWrites(categoryIds: number[], primaryCategoryId?: number | null) {
  return categoryIds.map((categoryId) => ({
    categoryId,
    isPrimary: categoryId === primaryCategoryId,
  }));
}

// POST /api/articles -- admin only.
articlesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = articleWriteSchema.parse(req.body);

    const article = await prisma.article.create({
      data: {
        title: data.title,
        slug: data.slug,
        excerpt: data.excerpt ?? null,
        content: data.content,
        status: data.status,
        authorId: data.authorId ?? null,
        featuredImageId: data.featuredImageId ?? null,
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : data.status === 'published' ? new Date() : null,
        seoTitle: data.seoTitle ?? null,
        seoDescription: data.seoDescription ?? null,
        seoFocusKeyword: data.seoFocusKeyword ?? null,
        canonicalUrl: data.canonicalUrl ?? null,
        ogImageUrl: data.ogImageUrl ?? null,
        isFeatured: data.isFeatured,
        featuredOrder: data.featuredOrder ?? null,
        articleCategories: { create: categoryRelationWrites(data.categoryIds, data.primaryCategoryId) },
        articleTags: { create: data.tagIds.map((tagId) => ({ tagId })) },
      },
      select: articleDetail,
    });

    res.status(201).json({ article });
  })
);

// PUT /api/articles/:id -- admin only.
articlesRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = articleWriteSchema.partial().parse(req.body);

    const article = await prisma.$transaction(async (tx) => {
      if (data.categoryIds) {
        await tx.articleCategory.deleteMany({ where: { articleId: id } });
        await tx.articleCategory.createMany({
          data: categoryRelationWrites(data.categoryIds, data.primaryCategoryId).map((c) => ({ articleId: id, ...c })),
        });
      }
      if (data.tagIds) {
        await tx.articleTag.deleteMany({ where: { articleId: id } });
        await tx.articleTag.createMany({ data: data.tagIds.map((tagId) => ({ articleId: id, tagId })) });
      }

      return tx.article.update({
        where: { id },
        data: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.slug !== undefined && { slug: data.slug }),
          ...(data.excerpt !== undefined && { excerpt: data.excerpt }),
          ...(data.content !== undefined && { content: data.content }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.authorId !== undefined && { authorId: data.authorId }),
          ...(data.featuredImageId !== undefined && { featuredImageId: data.featuredImageId }),
          ...(data.publishedAt !== undefined && { publishedAt: data.publishedAt ? new Date(data.publishedAt) : null }),
          ...(data.seoTitle !== undefined && { seoTitle: data.seoTitle }),
          ...(data.seoDescription !== undefined && { seoDescription: data.seoDescription }),
          ...(data.seoFocusKeyword !== undefined && { seoFocusKeyword: data.seoFocusKeyword }),
          ...(data.canonicalUrl !== undefined && { canonicalUrl: data.canonicalUrl }),
          ...(data.ogImageUrl !== undefined && { ogImageUrl: data.ogImageUrl }),
          ...(data.isFeatured !== undefined && { isFeatured: data.isFeatured }),
          ...(data.featuredOrder !== undefined && { featuredOrder: data.featuredOrder }),
          updatedAt: new Date(),
        },
        select: articleDetail,
      });
    });

    res.json({ article });
  })
);

// DELETE /api/articles/:id -- admin only.
articlesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.article.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  })
);
