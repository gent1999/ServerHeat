import { PrismaClient } from '@prisma/client';

// Single shared client; tsx watch mode can otherwise create a new one per
// reload and exhaust Postgres connections.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
