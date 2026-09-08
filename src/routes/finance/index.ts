import { Router } from 'express';
import { financeSummaryRouter } from './summary';
import { financeTrendRouter } from './trend';
import { financeSourcesRouter } from './sources';
import { financeEntriesRouter } from './entries';
import { financePayoutsRouter } from './payouts';
import { financeExpensesRouter } from './expenses';
import { financeTransactionsRouter } from './transactions';

export const financeRouter = Router();

financeRouter.use('/summary', financeSummaryRouter);
financeRouter.use('/monthly-trend', financeTrendRouter);
financeRouter.use('/sources', financeSourcesRouter);
financeRouter.use('/entries', financeEntriesRouter);
financeRouter.use('/payouts', financePayoutsRouter);
financeRouter.use('/expenses', financeExpensesRouter);
financeRouter.use('/transactions', financeTransactionsRouter);
