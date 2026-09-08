import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, HttpError } from '../../middleware/error-handler';
import { num, round2, startOfUTCDate } from '../../lib/finance-helpers';

export const financeExpensesRouter = Router();

financeExpensesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [expenses, totalAgg, monthlyAgg, yearlyAgg] = await Promise.all([
      prisma.expense.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.expense.aggregate({ _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { billingCycle: 'monthly' }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { billingCycle: 'yearly' }, _sum: { amount: true } }),
    ]);

    const today = startOfUTCDate(new Date());
    const result = expenses.map((expense) => {
      const daysUntilRenewal = expense.renewalDate
        ? Math.round((startOfUTCDate(expense.renewalDate).getTime() - today.getTime()) / 86_400_000)
        : null;
      return { ...expense, days_until_renewal: daysUntilRenewal };
    });

    res.json({
      expenses: result,
      totals: {
        total: round2(num(totalAgg._sum.amount)),
        monthly: round2(num(monthlyAgg._sum.amount)),
        yearly: round2(num(yearlyAgg._sum.amount)),
      },
    });
  })
);

const expenseWriteSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['domain', 'hosting', 'software', 'ads', 'other']).default('other'),
  amount: z.number(),
  billingCycle: z.enum(['one_time', 'monthly', 'yearly']).default('one_time'),
  vendor: z.string().nullable().optional(),
  renewalDate: z.string().nullable().optional(),
  paymentStatus: z.enum(['paid', 'pending']).default('paid'),
  notes: z.string().nullable().optional(),
});

financeExpensesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = expenseWriteSchema.parse(req.body);
    const expense = await prisma.expense.create({
      data: {
        name: data.name,
        category: data.category,
        amount: data.amount,
        billingCycle: data.billingCycle,
        vendor: data.vendor ?? null,
        renewalDate: data.renewalDate ? new Date(data.renewalDate) : null,
        paymentStatus: data.paymentStatus,
        notes: data.notes ?? null,
      },
    });
    res.status(201).json({ expense });
  })
);

financeExpensesRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = BigInt(req.params.id);
    const data = expenseWriteSchema.partial().parse(req.body);
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Expense not found');

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.billingCycle !== undefined && { billingCycle: data.billingCycle }),
        ...(data.vendor !== undefined && { vendor: data.vendor }),
        ...(data.renewalDate !== undefined && { renewalDate: data.renewalDate ? new Date(data.renewalDate) : null }),
        ...(data.paymentStatus !== undefined && { paymentStatus: data.paymentStatus }),
        ...(data.notes !== undefined && { notes: data.notes }),
        updatedAt: new Date(),
      },
    });
    res.json({ expense });
  })
);

financeExpensesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = BigInt(req.params.id);
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Expense not found');
    await prisma.expense.delete({ where: { id } });
    res.status(204).send();
  })
);
