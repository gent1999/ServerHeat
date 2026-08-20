import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AuthedRequest, requireAuth, requireAdminRole } from '../middleware/auth';
import { optionalAuth } from '../middleware/optional-auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';
import { articleCardSelect, articleDetailSelect } from '../lib/selections';

// Who posted an article is admin-only intelligence (which teammate
// published what) -- never exposed to anonymous/public requests.
const publisherSelect = { publishedByAdmin: { select: { id: true, email: true } } } as const;

export const articlesRouter = Router();

const articleCard = articleCardSelect;
const articleDetail = articleDetailSelect;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().optional(),
  tag: z.string().optional(),
  status: z.enum(['draft', 'published', 'all']).optional(),
  // z.coerce.boolean() would treat "false" as truthy (any non-empty
  // string coerces to true) -- match the literal string instead.
  isFeatured: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
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
    if (query.isFeatured !== undefined) {
      where.isFeatured = query.isFeatured;
    }

    const [total, articles] = await Promise.all([
      prisma.article.count({ where }),
      prisma.article.findMany({
        where,
        select: isAdmin ? { ...articleCard, ...publisherSelect } : articleCard,
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
    const isAdmin = Boolean(req.admin);
    const article = await prisma.article.findUnique({
      where: { slug: req.params.slug },
      select: isAdmin ? { ...articleDetail, ...publisherSelect } : articleDetail,
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
  spotifyUrl: z
    .string()
    .regex(/^https:\/\/open\.spotify\.com\/(track|album|playlist|episode|show|artist)\/[A-Za-z0-9]+/, 'Not a Spotify link')
    .nullable()
    .optional(),
  isFeatured: z.boolean().default(false),
  featuredOrder: z.number().int().nullable().optional(),
  categoryIds: z.array(z.number().int()).default([]),
  primaryCategoryId: z.number().int().nullable().optional(),
  tagIds: z.array(z.number().int()).default([]),
  galleryImageIds: z.array(z.number().int()).max(3, 'At most 3 extra photos').default([]),
});

function categoryRelationWrites(categoryIds: number[], primaryCategoryId?: number | null) {
  return categoryIds.map((categoryId) => ({
    categoryId,
    isPrimary: categoryId === primaryCategoryId,
  }));
}

function galleryRelationWrites(mediaIds: number[]) {
  return mediaIds.map((mediaId, position) => ({ mediaId, position }));
}

// POST /api/articles -- admin only. Only the "admin" role may set a
// homepage-featured status on create; an "editor" posting an article
// always lands unfeatured regardless of what's submitted.
articlesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = articleWriteSchema.parse(req.body);
    const canFeature = req.admin!.role === 'admin';

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
        spotifyUrl: data.spotifyUrl ?? null,
        isFeatured: canFeature ? data.isFeatured : false,
        featuredOrder: canFeature ? (data.featuredOrder ?? null) : null,
        publishedByAdminId: req.admin!.id,
        articleCategories: { create: categoryRelationWrites(data.categoryIds, data.primaryCategoryId) },
        articleTags: { create: data.tagIds.map((tagId) => ({ tagId })) },
        galleryImages: { create: galleryRelationWrites(data.galleryImageIds) },
      },
      select: articleDetail,
    });

    res.status(201).json({ article });
  })
);

// PUT /api/articles/:id -- admin only. Only the "admin" role may change
// homepage-featured status here (matches the star toggle's own guard,
// which is the only UI path that's supposed to touch these two fields).
articlesRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const data = articleWriteSchema.partial().parse(req.body);
    const canFeature = req.admin!.role === 'admin';
    if (!canFeature) {
      delete data.isFeatured;
      delete data.featuredOrder;
    }

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
      if (data.galleryImageIds) {
        await tx.articleGalleryImage.deleteMany({ where: { articleId: id } });
        await tx.articleGalleryImage.createMany({
          data: galleryRelationWrites(data.galleryImageIds).map((g) => ({ articleId: id, ...g })),
        });
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
          ...(data.spotifyUrl !== undefined && { spotifyUrl: data.spotifyUrl }),
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

// DELETE /api/articles/:id -- full admin only, not editor.
articlesRouter.delete(
  '/:id',
  requireAuth,
  requireAdminRole,
  asyncHandler(async (req, res) => {
    await prisma.article.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  })
);
