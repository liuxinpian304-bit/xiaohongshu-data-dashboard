import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/client/client';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:55432/xhs_dashboard';

export function createDatabaseClient(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export const prisma = createDatabaseClient(connectionString);
export type DatabaseClient = PrismaClient;
export type TransactionClient = Prisma.TransactionClient;
