import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, HttpError } from '../../middleware/error-handler';

// No PUT here -- payouts are add-or-delete only, never edited in place
// (matches how the Transactions table only offers Delete on payout rows).
export const financePayoutsRouter = Router();

financePayoutsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sourceId = req.query.source_id ? BigInt(String(req.query.source_id)) : undefined;
    const payouts = await prisma.payout.findMany({
      where: sourceId !== undefined ? { sourceId } : undefined,
      include: { source: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });
    res.json({ payouts });
  })
);

const payoutWriteSchema = z.object({
  sourceId: z.number().int().nullable(),
  amount: z.number(),
  date: z.string().optional(),
  notes: z.string().nullable().optional(),
  markEntriesPaid: z.boolean().default(false),
});

financePayoutsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = payoutWriteSchema.parse(req.body);

    const payout = await prisma.$transaction(async (tx) => {
      const created = await tx.payout.create({
        data: {
          sourceId: data.sourceId,
          amount: data.amount,
          date: data.date ? new Date(data.date) : new Date(),
          notes: data.notes ?? null,
        },
        include: { source: { select: { id: true, name: true } } },
      });

      if (data.markEntriesPaid && data.sourceId !== null) {
        await tx.revenueEntry.updateMany({
          where: { sourceId: data.sourceId, payoutStatus: 'not_ready' },
          data: { payoutStatus: 'paid_out', updatedAt: new Date() },
        });
      }

      return created;
    });

    res.status(201).json({ payout });
  })
);

financePayoutsRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = BigInt(req.params.id);
    const existing = await prisma.payout.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Payout not found');
    await prisma.payout.delete({ where: { id } });
    res.status(204).send();
  })
);
