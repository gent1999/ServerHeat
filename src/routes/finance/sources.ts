import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, HttpError } from '../../middleware/error-handler';
import { num, round2 } from '../../lib/finance-helpers';

export const financeSourcesRouter = Router();

// GET /api/finance/sources -- list, each with computed per-source fields.
// Done via a groupBy + JS merge rather than literal SQL correlated
// subqueries so it stays on the typed Prisma Client (which resolves this
// project's non-`public` schema automatically; raw queries don't -- see
// finance-helpers.ts) instead of raw SQL.
financeSourcesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [sources, balanceRows, lifetimeRows, countRows, lastEntryRows] = await Promise.all([
      prisma.revenueSource.findMany({ orderBy: { name: 'asc' } }),
      prisma.revenueEntry.groupBy({
        by: ['sourceId'],
        where: { payoutStatus: 'not_ready', paymentStatus: { not: 'cancelled' } },
        _sum: { netAmount: true },
      }),
      prisma.revenueEntry.groupBy({
        by: ['sourceId'],
        where: { paymentStatus: { not: 'cancelled' } },
        _sum: { netAmount: true },
      }),
      prisma.revenueEntry.groupBy({ by: ['sourceId'], _count: { _all: true } }),
      prisma.revenueEntry.groupBy({ by: ['sourceId'], _max: { date: true } }),
    ]);

    const balanceBySource = new Map(balanceRows.map((r) => [r.sourceId?.toString(), num(r._sum.netAmount)]));
    const lifetimeBySource = new Map(lifetimeRows.map((r) => [r.sourceId?.toString(), num(r._sum.netAmount)]));
    const countBySource = new Map(countRows.map((r) => [r.sourceId?.toString(), r._count._all]));
    const lastEntryBySource = new Map(lastEntryRows.map((r) => [r.sourceId?.toString(), r._max.date]));

    const result = sources.map((source) => {
      const key = source.id.toString();
      return {
        ...source,
        current_balance: round2(balanceBySource.get(key) ?? 0),
        lifetime_net: round2(lifetimeBySource.get(key) ?? 0),
        entry_count: countBySource.get(key) ?? 0,
        last_entry_date: lastEntryBySource.get(key) ?? null,
      };
    });

    res.json({ sources: result });
  })
);

const sourceWriteSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1).default('manual'),
  defaultGross: z.number().min(0).default(0),
  feeType: z.enum(['none', 'percentage', 'fixed']).default('none'),
  feeValue: z.number().min(0).default(0),
  payoutThreshold: z.number().min(0).default(0),
  status: z.enum(['active', 'pending', 'inactive']).default('active'),
  notes: z.string().nullable().optional(),
});

financeSourcesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = sourceWriteSchema.parse(req.body);
    const source = await prisma.revenueSource.create({ data: { ...data, notes: data.notes ?? null } });
    res.status(201).json({ source });
  })
);

financeSourcesRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = sourceWriteSchema.partial().parse(req.body);
    const source = await prisma.revenueSource.update({
      where: { id: BigInt(req.params.id) },
      data,
    });
    res.json({ source });
  })
);

financeSourcesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = BigInt(req.params.id);
    const source = await prisma.revenueSource.findUnique({ where: { id } });
    if (!source) throw new HttpError(404, 'Source not found');
    await prisma.revenueSource.delete({ where: { id } });
    res.status(204).send();
  })
);
