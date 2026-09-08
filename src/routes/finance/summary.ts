import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/error-handler';
import { num, round2, startOfUTCDate } from '../../lib/finance-helpers';

export const financeSummaryRouter = Router();

financeSummaryRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    const [
      revenueAgg,
      paidAgg,
      pendingAgg,
      expenseAgg,
      currentMonthRevenueAgg,
      lastMonthRevenueAgg,
      currentMonthExpenseAgg,
      sourcesWithThreshold,
      pendingBalanceRows,
      expensesWithRenewal,
    ] = await Promise.all([
      prisma.revenueEntry.aggregate({
        where: { paymentStatus: { not: 'cancelled' } },
        _sum: { grossAmount: true, netAmount: true },
      }),
      prisma.revenueEntry.aggregate({ where: { paymentStatus: 'paid' }, _sum: { netAmount: true } }),
      prisma.revenueEntry.aggregate({ where: { paymentStatus: 'pending' }, _sum: { netAmount: true } }),
      prisma.expense.aggregate({ _sum: { amount: true } }),
      prisma.revenueEntry.aggregate({
        where: { paymentStatus: { not: 'cancelled' }, date: { gte: monthStart, lt: nextMonthStart } },
        _sum: { netAmount: true },
      }),
      prisma.revenueEntry.aggregate({
        where: { paymentStatus: { not: 'cancelled' }, date: { gte: lastMonthStart, lt: monthStart } },
        _sum: { netAmount: true },
      }),
      prisma.expense.aggregate({
        where: { createdAt: { gte: monthStart, lt: nextMonthStart } },
        _sum: { amount: true },
      }),
      prisma.revenueSource.findMany({
        where: { payoutThreshold: { gt: 0 } },
        select: { id: true, name: true, payoutThreshold: true },
      }),
      prisma.revenueEntry.groupBy({
        by: ['sourceId'],
        where: { payoutStatus: 'not_ready', paymentStatus: { not: 'cancelled' } },
        _sum: { netAmount: true },
      }),
      prisma.expense.findMany({
        where: { renewalDate: { not: null } },
        select: { id: true, name: true, amount: true, renewalDate: true },
      }),
    ]);

    const totalGrossRevenue = round2(num(revenueAgg._sum.grossAmount));
    const totalNetRevenue = round2(num(revenueAgg._sum.netAmount));
    const paidRevenue = round2(num(paidAgg._sum.netAmount));
    const pendingRevenue = round2(num(pendingAgg._sum.netAmount));
    const totalExpenses = round2(num(expenseAgg._sum.amount));
    const currentMonthRevenue = round2(num(currentMonthRevenueAgg._sum.netAmount));
    const lastMonthRevenue = round2(num(lastMonthRevenueAgg._sum.netAmount));
    const monthlyExpenses = round2(num(currentMonthExpenseAgg._sum.amount));

    const balanceBySource = new Map(pendingBalanceRows.map((r) => [r.sourceId?.toString(), num(r._sum.netAmount)]));
    const payoutProgressBySource = sourcesWithThreshold.map((source) => {
      const pendingBalance = round2(balanceBySource.get(source.id.toString()) ?? 0);
      const threshold = num(source.payoutThreshold);
      const remaining = round2(Math.max(threshold - pendingBalance, 0));
      const progress = threshold > 0 ? Math.min(100, round2((pendingBalance / threshold) * 100)) : 0;
      return {
        sourceId: source.id,
        sourceName: source.name,
        pendingBalance,
        threshold,
        remaining,
        progress,
        ready: pendingBalance >= threshold,
      };
    });

    const today = startOfUTCDate(now);
    const upcomingRenewals = expensesWithRenewal
      .map((expense) => {
        const daysUntil = Math.round((startOfUTCDate(expense.renewalDate!).getTime() - today.getTime()) / 86_400_000);
        return { id: expense.id, name: expense.name, amount: num(expense.amount), renewalDate: expense.renewalDate, daysUntil };
      })
      // CRITICAL: never surface a past-due renewal_date as an active alert --
      // an expired one-time expense is historical data, not an alert.
      .filter((r) => r.daysUntil >= 0 && r.daysUntil <= 90)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    res.json({
      totalGrossRevenue,
      totalNetRevenue,
      paidRevenue,
      pendingRevenue,
      totalExpenses,
      lifetimeProfit: round2(totalNetRevenue - totalExpenses),
      currentMonthRevenue,
      lastMonthRevenue,
      currentMonthProfit: round2(currentMonthRevenue - monthlyExpenses),
      monthlyExpenses,
      payoutProgressBySource,
      upcomingRenewals,
    });
  })
);
