import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error-handler';
import { financeSchemaName } from '../../lib/finance-helpers';

export const financeTransactionsRouter = Router();

const querySchema = z.object({
  type: z.enum(['income', 'expense', 'payout']).optional(),
  source_id: z.coerce.number().int().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  payment_status: z.enum(['pending', 'paid', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

interface UnifiedRow {
  id: bigint;
  kind: 'income' | 'expense' | 'payout';
  date: Date;
  source_id: bigint | null;
  source_name: string | null;
  description: string;
  amount: Prisma.Decimal;
  article_title: string | null;
  client_name: string | null;
  vendor: string | null;
  category: string | null;
  billing_cycle: string | null;
  renewal_date: Date | null;
  gross_amount: Prisma.Decimal | null;
  fee_amount: Prisma.Decimal | null;
  net_amount: Prisma.Decimal | null;
  payment_status: string | null;
  payout_status: string | null;
  article_url: string | null;
  notes: string | null;
  created_at: Date;
}

// GET /api/finance/transactions -- the unified ledger. A read-only merged
// view across the three real tables via UNION ALL (the underlying tables
// stay separate; this isn't a schema change). Postgres requires every
// UNION ALL branch to have the same type per column position, so columns
// that only apply to one kind are explicitly NULL-cast in the others.
financeTransactionsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const schema = await financeSchemaName();
    const s = Prisma.raw(`"${schema}"`);

    const conditions: Prisma.Sql[] = [];
    if (query.type) conditions.push(Prisma.sql`kind = ${query.type}`);
    if (query.source_id !== undefined) conditions.push(Prisma.sql`source_id = ${BigInt(query.source_id)}`);
    if (query.from) conditions.push(Prisma.sql`date >= ${query.from}::date`);
    if (query.to) conditions.push(Prisma.sql`date <= ${query.to}::date`);
    if (query.payment_status) conditions.push(Prisma.sql`payment_status = ${query.payment_status}`);

    const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const rows = await prisma.$queryRaw<UnifiedRow[]>`
      SELECT * FROM (
        SELECT
          e.id AS id,
          'income'::text AS kind,
          e.date AS date,
          e.source_id AS source_id,
          rs.name AS source_name,
          COALESCE(e.article_title, e.client_name, 'Revenue') AS description,
          e.net_amount AS amount,
          e.article_title AS article_title,
          e.client_name AS client_name,
          NULL::text AS vendor,
          NULL::text AS category,
          NULL::text AS billing_cycle,
          NULL::date AS renewal_date,
          e.gross_amount AS gross_amount,
          e.fee_amount AS fee_amount,
          e.net_amount AS net_amount,
          e.payment_status::text AS payment_status,
          e.payout_status::text AS payout_status,
          e.article_url AS article_url,
          e.notes AS notes,
          e.created_at AS created_at
        FROM ${s}.revenue_entries e
        LEFT JOIN ${s}.revenue_sources rs ON rs.id = e.source_id

        UNION ALL

        SELECT
          x.id AS id,
          'expense'::text AS kind,
          x.created_at::date AS date,
          NULL::bigint AS source_id,
          NULL::text AS source_name,
          x.name AS description,
          -x.amount AS amount,
          NULL::text AS article_title,
          NULL::text AS client_name,
          x.vendor AS vendor,
          x.category::text AS category,
          x.billing_cycle::text AS billing_cycle,
          x.renewal_date AS renewal_date,
          NULL::numeric AS gross_amount,
          NULL::numeric AS fee_amount,
          NULL::numeric AS net_amount,
          x.payment_status::text AS payment_status,
          NULL::text AS payout_status,
          NULL::text AS article_url,
          x.notes AS notes,
          x.created_at AS created_at
        FROM ${s}.expenses x

        UNION ALL

        SELECT
          p.id AS id,
          'payout'::text AS kind,
          p.date AS date,
          p.source_id AS source_id,
          rs.name AS source_name,
          'Payout received'::text AS description,
          p.amount AS amount,
          NULL::text AS article_title,
          NULL::text AS client_name,
          NULL::text AS vendor,
          NULL::text AS category,
          NULL::text AS billing_cycle,
          NULL::date AS renewal_date,
          NULL::numeric AS gross_amount,
          NULL::numeric AS fee_amount,
          NULL::numeric AS net_amount,
          NULL::text AS payment_status,
          NULL::text AS payout_status,
          NULL::text AS article_url,
          p.notes AS notes,
          p.created_at AS created_at
        FROM ${s}.payouts p
        LEFT JOIN ${s}.revenue_sources rs ON rs.id = p.source_id
      ) unified
      ${whereClause}
      ORDER BY date DESC, created_at DESC
      LIMIT ${query.limit}
    `;

    res.json({ transactions: rows });
  })
);
