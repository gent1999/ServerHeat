import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdminRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';

export const maintenanceRouter = Router();

// TEMPORARY -- creates the brand-new Finance tables/enums directly against
// production using the production Prisma client's own (Vercel "Sensitive",
// locally unreadable) DATABASE_URL, since `prisma db push` can't be run
// locally right now (local Postgres is down) and this can't be read back
// out to run it manually. Zero deploy-ordering risk unlike the earlier
// editorialType migration -- these are entirely new tables nothing existing
// queries, so it doesn't matter whether this runs before or after the app
// code referencing them deploys. Idempotent (safe to call more than once).
// Remove this route once confirmed applied.
maintenanceRouter.post(
  '/create-finance-schema',
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

      const enums: [string, string[]][] = [
        ['fee_type', ['none', 'percentage', 'fixed']],
        ['source_status', ['active', 'pending', 'inactive']],
        ['revenue_payment_status', ['pending', 'paid', 'cancelled']],
        ['payout_status', ['not_ready', 'ready_for_payout', 'paid_out']],
        ['expense_category', ['domain', 'hosting', 'software', 'ads', 'other']],
        ['billing_cycle', ['one_time', 'monthly', 'yearly']],
        ['expense_payment_status', ['paid', 'pending']],
      ];
      for (const [name, values] of enums) {
        const valuesSql = values.map((v) => `'${v}'`).join(',');
        await prisma.$executeRawUnsafe(`
          DO $$ BEGIN
            CREATE TYPE "${schema}"."${name}" AS ENUM (${valuesSql});
          EXCEPTION WHEN duplicate_object THEN null; END $$;
        `);
        steps.push(`enum ${name}`);
      }

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${schema}"."revenue_sources" (
          "id" BIGSERIAL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "type" TEXT NOT NULL DEFAULT 'manual',
          "default_gross" NUMERIC(12,2) NOT NULL DEFAULT 0,
          "fee_type" "${schema}"."fee_type" NOT NULL DEFAULT 'none',
          "fee_value" NUMERIC(12,2) NOT NULL DEFAULT 0,
          "payout_threshold" NUMERIC(12,2) NOT NULL DEFAULT 0,
          "status" "${schema}"."source_status" NOT NULL DEFAULT 'active',
          "notes" TEXT,
          "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
        );
      `);
      steps.push('table revenue_sources');

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${schema}"."revenue_entries" (
          "id" BIGSERIAL PRIMARY KEY,
          "date" DATE NOT NULL DEFAULT CURRENT_DATE,
          "source_id" BIGINT REFERENCES "${schema}"."revenue_sources"("id") ON DELETE SET NULL,
          "article_title" TEXT,
          "article_url" TEXT,
          "client_name" TEXT,
          "gross_amount" NUMERIC(12,2) NOT NULL,
          "fee_amount" NUMERIC(12,2) NOT NULL DEFAULT 0,
          "net_amount" NUMERIC(12,2) NOT NULL DEFAULT 0,
          "payment_status" "${schema}"."revenue_payment_status" NOT NULL DEFAULT 'pending',
          "payout_status" "${schema}"."payout_status" NOT NULL DEFAULT 'not_ready',
          "notes" TEXT,
          "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
        );
      `);
      steps.push('table revenue_entries');
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "revenue_entries_source_id_idx" ON "${schema}"."revenue_entries" ("source_id");`
      );
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "revenue_entries_date_idx" ON "${schema}"."revenue_entries" ("date");`);
      steps.push('indexes revenue_entries');

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${schema}"."payouts" (
          "id" BIGSERIAL PRIMARY KEY,
          "source_id" BIGINT REFERENCES "${schema}"."revenue_sources"("id") ON DELETE SET NULL,
          "amount" NUMERIC(12,2) NOT NULL,
          "date" DATE NOT NULL DEFAULT CURRENT_DATE,
          "notes" TEXT,
          "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
        );
      `);
      steps.push('table payouts');
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payouts_source_id_idx" ON "${schema}"."payouts" ("source_id");`);
      steps.push('index payouts');

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${schema}"."expenses" (
          "id" BIGSERIAL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "category" "${schema}"."expense_category" NOT NULL DEFAULT 'other',
          "amount" NUMERIC(12,2) NOT NULL,
          "billing_cycle" "${schema}"."billing_cycle" NOT NULL DEFAULT 'one_time',
          "vendor" TEXT,
          "renewal_date" DATE,
          "payment_status" "${schema}"."expense_payment_status" NOT NULL DEFAULT 'paid',
          "notes" TEXT,
          "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
        );
      `);
      steps.push('table expenses');
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "expenses_renewal_date_idx" ON "${schema}"."expenses" ("renewal_date");`);
      steps.push('index expenses');

      res.json({ ok: true, steps });
    } catch (err) {
      res.status(500).json({ ok: false, steps, message: err instanceof Error ? err.message : String(err) });
    }
  })
);
