import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export function num(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return value.toNumber();
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type FeeType = 'none' | 'percentage' | 'fixed';

export function computeFee(gross: number, feeType: FeeType, feeValue: number): number {
  if (feeType === 'percentage') return round2((gross * feeValue) / 100);
  if (feeType === 'fixed') return round2(feeValue);
  return 0;
}

export function startOfUTCDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// $queryRaw/$executeRaw run outside the typed Prisma Client's own schema
// resolution -- unqualified table names fail against this project's
// non-`public` schema even though every typed Prisma Client call resolves
// them fine. Detected once (via information_schema, not hardcoded) and
// cached for the process lifetime; only the transactions endpoint needs
// this, since it's the one query Prisma's query builder can't express
// (UNION ALL across three tables).
let cachedSchema: string | null = null;

export async function financeSchemaName(): Promise<string> {
  if (cachedSchema) return cachedSchema;
  const rows = await prisma.$queryRaw<{ table_schema: string }[]>`
    SELECT table_schema FROM information_schema.tables WHERE table_name = 'revenue_sources' LIMIT 1
  `;
  cachedSchema = rows[0]?.table_schema ?? 'public';
  return cachedSchema;
}
