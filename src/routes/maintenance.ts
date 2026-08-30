import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdminRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';

export const maintenanceRouter = Router();

// TEMPORARY -- applies the editorialType/isTrending/isEditorsPick schema
// change using the production Prisma client's own (Vercel "Sensitive",
// locally unreadable) DATABASE_URL, since it can't be pulled down and run
// through `prisma db push` locally. Idempotent (safe to call more than
// once). Remove this route once the schema change has been confirmed live.
maintenanceRouter.post(
  '/apply-editorial-schema',
  requireAuth,
  requireAdminRole,
  asyncHandler(async (_req, res) => {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "editorial_type" AS ENUM ('INTERVIEW','ARTIST_SPOTLIGHT','MUSIC_REVIEW','NEW_RELEASE','MUSIC_NEWS','FASHION','STREETWEAR','BRAND_SPOTLIGHT','CULTURE','OTHER');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await prisma.$executeRawUnsafe(`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "editorial_type" "editorial_type";`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "is_trending" BOOLEAN NOT NULL DEFAULT false;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "is_editors_pick" BOOLEAN NOT NULL DEFAULT false;`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "articles_editorial_type_idx" ON "articles" ("editorial_type", "status", "published_at" DESC);`
    );
    res.json({ ok: true });
  })
);
