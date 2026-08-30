import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdminRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';

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
    const steps: string[] = [];
    try {
      const rows = await prisma.$queryRawUnsafe<{ table_schema: string }[]>(
        `SELECT table_schema FROM information_schema.tables WHERE table_name = 'articles' LIMIT 1;`
      );
      const schema = rows[0]?.table_schema;
      if (!schema) throw new HttpError(500, 'Could not find the "articles" table in any schema');
      steps.push(`detected schema: ${schema}`);

      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          CREATE TYPE "${schema}"."editorial_type" AS ENUM ('INTERVIEW','ARTIST_SPOTLIGHT','MUSIC_REVIEW','NEW_RELEASE','MUSIC_NEWS','FASHION','STREETWEAR','BRAND_SPOTLIGHT','CULTURE','OTHER');
        EXCEPTION WHEN duplicate_object THEN null; END $$;
      `);
      steps.push('enum');
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${schema}"."articles" ADD COLUMN IF NOT EXISTS "editorial_type" "${schema}"."editorial_type";`
      );
      steps.push('editorial_type column');
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${schema}"."articles" ADD COLUMN IF NOT EXISTS "is_trending" BOOLEAN NOT NULL DEFAULT false;`
      );
      steps.push('is_trending column');
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${schema}"."articles" ADD COLUMN IF NOT EXISTS "is_editors_pick" BOOLEAN NOT NULL DEFAULT false;`
      );
      steps.push('is_editors_pick column');
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "articles_editorial_type_idx" ON "${schema}"."articles" ("editorial_type", "status", "published_at" DESC);`
      );
      steps.push('index');
      res.json({ ok: true, steps });
    } catch (err) {
      res.status(500).json({ ok: false, steps, message: err instanceof Error ? err.message : String(err) });
    }
  })
);
