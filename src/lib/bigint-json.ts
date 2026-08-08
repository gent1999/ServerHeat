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

export {};
