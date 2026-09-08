import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, HttpError } from '../../middleware/error-handler';
import { num, round2, monthKey, MONTH_LABELS } from '../../lib/finance-helpers';

export const financeTrendRouter = Router();

// GET /api/finance/monthly-trend?range=last12|YYYY
financeTrendRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rangeParam = String(req.query.range || 'last12');
    const now = new Date();

    const months: { year: number; month: number }[] = [];
    if (rangeParam === 'last12') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
      }
    } else if (/^\d{4}$/.test(rangeParam)) {
      const year = Number(rangeParam);
      for (let m = 0; m < 12; m++) months.push({ year, month: m });
    } else {
      throw new HttpError(400, 'range must be "last12" or a 4-digit year');
    }

    const rangeStart = new Date(Date.UTC(months[0].year, months[0].month, 1));
    const rangeEnd = new Date(Date.UTC(months[months.length - 1].year, months[months.length - 1].month + 1, 1));

    const [entries, expenses, minEntryAgg, minExpenseAgg] = await Promise.all([
      prisma.revenueEntry.findMany({
        where: { paymentStatus: { not: 'cancelled' }, date: { gte: rangeStart, lt: rangeEnd } },
        select: { date: true, netAmount: true },
      }),
      prisma.expense.findMany({
        where: { createdAt: { gte: rangeStart, lt: rangeEnd } },
        select: { createdAt: true, amount: true },
      }),
      prisma.revenueEntry.aggregate({ _min: { date: true } }),
      prisma.expense.aggregate({ _min: { createdAt: true } }),
    ]);

    const revenueByKey = new Map<string, number>();
    for (const entry of entries) {
      const key = monthKey(entry.date);
      revenueByKey.set(key, (revenueByKey.get(key) ?? 0) + num(entry.netAmount));
    }
    const expensesByKey = new Map<string, number>();
    for (const expense of expenses) {
      const key = monthKey(expense.createdAt);
      expensesByKey.set(key, (expensesByKey.get(key) ?? 0) + num(expense.amount));
    }

    // Continuous timeline: every month in range gets an entry even with
    // zero activity, so the chart never skips an empty month.
    const trend = months.map(({ year, month }) => {
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      const revenue = round2(revenueByKey.get(key) ?? 0);
      const expensesTotal = round2(expensesByKey.get(key) ?? 0);
      return { month: key, label: MONTH_LABELS[month], revenue, expenses: expensesTotal, profit: round2(revenue - expensesTotal) };
    });

    const currentYear = now.getUTCFullYear();
    const minYearCandidates = [minEntryAgg._min.date?.getUTCFullYear(), minExpenseAgg._min.createdAt?.getUTCFullYear()].filter(
      (y): y is number => typeof y === 'number'
    );
    const minYear = minYearCandidates.length > 0 ? Math.min(...minYearCandidates) : currentYear;
    const availableYears: number[] = [];
    for (let y = currentYear; y >= minYear; y--) availableYears.push(y);

    res.json({ trend, availableYears, range: rangeParam });
  })
);
