// One-time-ish helper: creates (or updates the password of) an admin_users
// row from SEED_ADMIN_* env vars, so there's a way to log into the admin
// panel locally. Safe to re-run.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || 'Admin';

  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set (see .env.example)');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash, name },
    create: { email, passwordHash, name, role: 'admin' },
  });

  console.log(`Admin user ready: ${admin.email} (id ${admin.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
