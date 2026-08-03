import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/client/client';
export { Prisma } from '../generated/client/client';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:55432/xhs_dashboard';

export function createDatabaseClient(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export const prisma = createDatabaseClient(connectionString);
export async function verifyRuntimeDatabaseRole(client: PrismaClient = prisma) {
  if (process.env.DATABASE_REQUIRE_RUNTIME_ROLE !== 'true') return;
  const [row] = await client.$queryRaw<Array<{ currentUser: string; canUpdate: boolean; canDelete: boolean; canTruncate: boolean }>>`
    SELECT current_user AS "currentUser",
      has_table_privilege(current_user, '"MetricSnapshot"', 'UPDATE') AS "canUpdate",
      has_table_privilege(current_user, '"MetricSnapshot"', 'DELETE') AS "canDelete",
      has_table_privilege(current_user, '"MetricSnapshot"', 'TRUNCATE') AS "canTruncate"`;
  if (!row || row.currentUser === 'postgres' || row.canUpdate || row.canDelete || row.canTruncate) throw new Error('database runtime role is not safely restricted');
}
export type DatabaseClient = PrismaClient;
export type TransactionClient = Prisma.TransactionClient;
