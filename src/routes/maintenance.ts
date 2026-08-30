import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdminRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';

export const maintenanceRouter = Router();

// TEMPORARY -- migrates articles.editorial_type (single, nullable) to a
// many-to-many article_editorial_types join table, using the production
// Prisma client's own (Vercel "Sensitive", locally unreadable) DATABASE_URL.
//
// Two phases, called in order, with an app deploy in between, to avoid
// repeating the earlier outage (code deployed expecting a column/table that
// doesn't exist yet):
//   1. add-table  -- purely additive: creates article_editorial_types.
//                    Safe to run while the OLD code (still reading/writing
//                    the flat editorial_type column) is live.
//   2. [deploy new app code that uses the join table instead]
//   3. drop-column -- removes the now-unused articles.editorial_type column
//                     and its index. Only run after the new code is
//                     confirmed live and no longer referencing it.
maintenanceRouter.post(
  '/migrate-editorial-types/:phase',
  requireAuth,
  requireAdminRole,
  asyncHandler(async (req, res) => {
    const phase = z.enum(['add-table', 'drop-column']).parse(req.params.phase);
    const steps: string[] = [];
    try {
      const rows = await prisma.$queryRawUnsafe<{ table_schema: string }[]>(
        `SELECT table_schema FROM information_schema.tables WHERE table_name = 'articles' LIMIT 1;`
      );
      const schema = rows[0]?.table_schema;
      if (!schema) throw new HttpError(500, 'Could not find the "articles" table in any schema');
      steps.push(`detected schema: ${schema}`);

      if (phase === 'add-table') {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "${schema}"."article_editorial_types" (
            "article_id" BIGINT NOT NULL REFERENCES "${schema}"."articles"("id") ON DELETE CASCADE,
            "editorial_type" "${schema}"."editorial_type" NOT NULL,
            PRIMARY KEY ("article_id", "editorial_type")
          );
        `);
        steps.push('article_editorial_types table');
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "article_editorial_types_editorial_type_idx" ON "${schema}"."article_editorial_types" ("editorial_type");`
        );
        steps.push('index');

        // Carry forward any real (non-null) values already set on the flat
        // column into the new join table before it's dropped -- there
        // shouldn't be any real ones yet, but this makes the migration
        // lossless regardless.
        await prisma.$executeRawUnsafe(`
          INSERT INTO "${schema}"."article_editorial_types" ("article_id", "editorial_type")
          SELECT "id", "editorial_type" FROM "${schema}"."articles" WHERE "editorial_type" IS NOT NULL
          ON CONFLICT DO NOTHING;
        `);
        steps.push('backfilled existing values');
      } else {
        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${schema}"."articles_editorial_type_idx";`);
        steps.push('dropped old index');
        await prisma.$executeRawUnsafe(`ALTER TABLE "${schema}"."articles" DROP COLUMN IF EXISTS "editorial_type";`);
        steps.push('dropped editorial_type column');
      }

      res.json({ ok: true, phase, steps });
    } catch (err) {
      res.status(500).json({ ok: false, phase, steps, message: err instanceof Error ? err.message : String(err) });
    }
  })
);
