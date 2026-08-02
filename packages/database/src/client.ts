import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/client/client';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:55432/xhs_dashboard';

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
export type DatabaseClient = PrismaClient;
export type TransactionClient = Prisma.TransactionClient;
