import { Prisma } from '@prisma/client';

// Prisma maps Postgres BIGINT columns (our id columns) to JS BigInt, which
// JSON.stringify can't serialize on its own. Every id in this schema is
// far below Number.MAX_SAFE_INTEGER, so it's safe to just emit them as
// plain numbers in API responses.
declare global {
  interface BigInt {
    toJSON(): number;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (this: bigint) {
  return Number(this);
};

// Same idea for Postgres NUMERIC columns (the finance schema's money
// fields), which Prisma maps to a Decimal.js instance -- JSON.stringify
// would otherwise emit these as strings. This is a simple financial
// dashboard, not accounting software; treating money as plain numbers
// (like every other numeric value in this API) keeps the frontend from
// having to parse currency strings everywhere.
(Prisma.Decimal.prototype as unknown as { toJSON(): number }).toJSON = function (this: Prisma.Decimal) {
  return this.toNumber();
};

export {};
