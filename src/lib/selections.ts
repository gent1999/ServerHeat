// Shared Prisma `select` shapes so the article card/detail projection is
// defined once instead of drifting across articles.ts, home.ts, and
// paginate-articles.ts.
export const articleCardSelect = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
  isFeatured: true,
  featuredOrder: true,
  author: { select: { id: true, name: true, slug: true } },
  featuredImage: { select: { id: true, sourceUrl: true, altText: true } },
  articleCategories: {
    select: { isPrimary: true, category: { select: { id: true, name: true, slug: true } } },
  },
} as const;

export const articleDetailSelect = {
  ...articleCardSelect,
  content: true,
  seoTitle: true,
  seoDescription: true,
  seoFocusKeyword: true,
  canonicalUrl: true,
  ogImageUrl: true,
  spotifyUrl: true,
  soundcloudUrl: true,
  youtubeUrl: true,
  articleTags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
  galleryImages: {
    select: { media: { select: { id: true, sourceUrl: true, altText: true } } },
    orderBy: { position: 'asc' },
  },
} as const;
