import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, HttpError } from '../../middleware/error-handler';
import { num, round2 } from '../../lib/finance-helpers';

export const financeEntriesRouter = Router();

const listQuerySchema = z.object({
  source_id: z.coerce.number().int().optional(),
  payment_status: z.enum(['pending', 'paid', 'cancelled']).optional(),
  payout_status: z.enum(['not_ready', 'ready_for_payout', 'paid_out']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

financeEntriesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const where: Prisma.RevenueEntryWhereInput = {};
    if (query.source_id !== undefined) where.sourceId = query.source_id;
    if (query.payment_status) where.paymentStatus = query.payment_status;
    if (query.payout_status) where.payoutStatus = query.payout_status;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [entries, agg] = await Promise.all([
      prisma.revenueEntry.findMany({
        where,
        include: { source: { select: { id: true, name: true } } },
        orderBy: { date: 'desc' },
      }),
      prisma.revenueEntry.aggregate({ where, _sum: { grossAmount: true, feeAmount: true, netAmount: true } }),
    ]);

    res.json({
      entries,
      totals: {
        gross: round2(num(agg._sum.grossAmount)),
        fee: round2(num(agg._sum.feeAmount)),
        net: round2(num(agg._sum.netAmount)),
      },
    });
  })
);

const entryWriteSchema = z.object({
  date: z.string().optional(),
  sourceId: z.number().int().nullable().optional(),
  articleTitle: z.string().nullable().optional(),
  articleUrl: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  grossAmount: z.number(),
  feeAmount: z.number().default(0),
  netAmount: z.number().optional(),
  paymentStatus: z.enum(['pending', 'paid', 'cancelled']).default('pending'),
  payoutStatus: z.enum(['not_ready', 'ready_for_payout', 'paid_out']).default('not_ready'),
  notes: z.string().nullable().optional(),
});

function resolveNet(gross: number, fee: number, net: number | undefined): number {
  return round2(net !== undefined ? net : gross - fee);
}

financeEntriesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = entryWriteSchema.parse(req.body);
    const entry = await prisma.revenueEntry.create({
      data: {
        date: data.date ? new Date(data.date) : new Date(),
        sourceId: data.sourceId ?? null,
        articleTitle: data.articleTitle ?? null,
        articleUrl: data.articleUrl ?? null,
        clientName: data.clientName ?? null,
        grossAmount: data.grossAmount,
        feeAmount: data.feeAmount,
        netAmount: resolveNet(data.grossAmount, data.feeAmount, data.netAmount),
        paymentStatus: data.paymentStatus,
        payoutStatus: data.payoutStatus,
        notes: data.notes ?? null,
      },
      include: { source: { select: { id: true, name: true } } },
    });
    res.status(201).json({ entry });
  })
);

financeEntriesRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = BigInt(req.params.id);
    const data = entryWriteSchema.partial().parse(req.body);

    const existing = await prisma.revenueEntry.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Revenue entry not found');

    const gross = data.grossAmount ?? num(existing.grossAmount);
    const fee = data.feeAmount ?? num(existing.feeAmount);
    const netProvided = data.netAmount;

    const entry = await prisma.revenueEntry.update({
      where: { id },
      data: {
        ...(data.date !== undefined && { date: new Date(data.date) }),
        ...(data.sourceId !== undefined && { sourceId: data.sourceId }),
        ...(data.articleTitle !== undefined && { articleTitle: data.articleTitle }),
        ...(data.articleUrl !== undefined && { articleUrl: data.articleUrl }),
        ...(data.clientName !== undefined && { clientName: data.clientName }),
        ...(data.grossAmount !== undefined && { grossAmount: data.grossAmount }),
        ...(data.feeAmount !== undefined && { feeAmount: data.feeAmount }),
        netAmount: resolveNet(gross, fee, netProvided),
        ...(data.paymentStatus !== undefined && { paymentStatus: data.paymentStatus }),
        ...(data.payoutStatus !== undefined && { payoutStatus: data.payoutStatus }),
        ...(data.notes !== undefined && { notes: data.notes }),
        updatedAt: new Date(),
      },
      include: { source: { select: { id: true, name: true } } },
    });
    res.json({ entry });
  })
);

financeEntriesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = BigInt(req.params.id);
    const existing = await prisma.revenueEntry.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Revenue entry not found');
    await prisma.revenueEntry.delete({ where: { id } });
    res.status(204).send();
  })
);
