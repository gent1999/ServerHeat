import { Router } from 'express';
import { z } from 'zod';
import type { EditorialType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/error-handler';
import { articleCardSelect } from '../lib/selections';

export const homeRouter = Router();

const homeQuerySchema = z.object({
  featuredCount: z.coerce.number().int().min(1).max(12).default(4),
  sectionCount: z.coerce.number().int().min(1).max(12).default(4),
});

// Which editorial types feed each homepage rail. Deliberately overlapping
// (e.g. ARTIST_SPOTLIGHT feeds three different sections) -- sequential
// exclusion in the handler below is what keeps the same article from
// showing up twice on the page.
const FRESH_HEAT_TYPES: EditorialType[] = ['INTERVIEW', 'ARTIST_SPOTLIGHT', 'MUSIC_REVIEW', 'NEW_RELEASE', 'MUSIC_NEWS'];
const FACE_OF_THE_HEAT_TYPES: EditorialType[] = ['ARTIST_SPOTLIGHT', 'INTERVIEW'];
const FIRST_LISTEN_TYPES: EditorialType[] = ['NEW_RELEASE', 'MUSIC_REVIEW'];
const NEXT_UP_TYPES: EditorialType[] = ['ARTIST_SPOTLIGHT', 'INTERVIEW', 'NEW_RELEASE'];
const STYLE_REPORT_TYPES: EditorialType[] = ['FASHION', 'STREETWEAR', 'BRAND_SPOTLIGHT'];

// GET /api/home -- one round trip for the whole landing page: a featured
// rail (curated via admin, falling back to the most recent published
// articles until anything is actually marked featured) plus a set of
// editorial rails driven by `editorialType`/`isTrending`.
//
// Sections are built in sequence, not in parallel, because each one
// excludes every article ID already used by an earlier section -- without
// that, the same handful of classified articles would repeat across every
// rail while the new editorial taxonomy is still thin. Still just one
// query per section (no N+1, no client-side filtering).
homeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = homeQuerySchema.parse(req.query);
    const usedIds = new Set<bigint>();

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
    featured.forEach((a) => usedIds.add(a.id));

    async function pickByType(editorialTypes: EditorialType[], take: number) {
      const articles = await prisma.article.findMany({
        where: {
          status: 'published',
          editorialType: { in: editorialTypes },
          id: { notIn: [...usedIds] },
        },
        select: articleCardSelect,
        // Editor's Pick stories surface first within whichever rails they
        // qualify for; otherwise newest first.
        orderBy: [{ isEditorsPick: 'desc' }, { publishedAt: 'desc' }],
        take,
      });
      articles.forEach((a) => usedIds.add(a.id));
      return articles;
    }

    const freshHeat = await pickByType(FRESH_HEAT_TYPES, query.sectionCount);
    const faceOfTheHeat = await pickByType(FACE_OF_THE_HEAT_TYPES, query.sectionCount);
    const firstListen = await pickByType(FIRST_LISTEN_TYPES, query.sectionCount);
    // A handful more music stories to sit next to the Heat Check Spotify
    // embed -- reusing freshHeat's own list here would just repeat the same
    // cards further down the page.
    const heatCheckStories = await pickByType(FRESH_HEAT_TYPES, Math.min(4, query.sectionCount));
    const nextUp = await pickByType(NEXT_UP_TYPES, query.sectionCount);
    const styleReport = await pickByType(STYLE_REPORT_TYPES, query.sectionCount);

    // "Most Heated" -- there's no view-count/analytics data at the article
    // level, so this is manually-marked trending stories first (an explicit
    // editorial call, so any article qualifies regardless of type), padded
    // out with the newest *already-classified* content if needed. It never
    // falls back to unclassified legacy articles just to fill space -- that
    // would put old general-interest content back in the homepage spotlight.
    const trending = await prisma.article.findMany({
      where: { status: 'published', isTrending: true, id: { notIn: [...usedIds] } },
      select: articleCardSelect,
      orderBy: { publishedAt: 'desc' },
      take: query.sectionCount,
    });
    trending.forEach((a) => usedIds.add(a.id));

    let mostHeated = trending;
    if (mostHeated.length < query.sectionCount) {
      const filler = await prisma.article.findMany({
        where: { status: 'published', editorialType: { not: null }, id: { notIn: [...usedIds] } },
        select: articleCardSelect,
        orderBy: { publishedAt: 'desc' },
        take: query.sectionCount - mostHeated.length,
      });
      mostHeated = [...mostHeated, ...filler];
    }

    res.json({ featured, freshHeat, faceOfTheHeat, firstListen, heatCheckStories, nextUp, styleReport, mostHeated });
  })
);
