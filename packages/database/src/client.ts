import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/client/client';
export { Prisma } from '../generated/client/client';

type DatabaseEnvironment = Record<string, string | undefined>;

export function assertTestDatabase(url: string) {
  let databaseName: string;
  try {
    databaseName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('invalid_database_url');
  }
  if (databaseName !== 'xhs_dashboard_test') throw new Error('runtime_database_forbidden');
}

export function databaseUrlFromEnvironment(environment: DatabaseEnvironment = process.env) {
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (environment.NODE_ENV === 'test' && environment.DATABASE_ALLOW_PRIVILEGED_TEST_ROLE === 'true') assertTestDatabase(environment.DATABASE_URL);
  return environment.DATABASE_URL;
}

export function createDatabaseClient(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export const prisma = createDatabaseClient(databaseUrlFromEnvironment());
export async function verifyRuntimeDatabaseRole(client: PrismaClient = prisma, environment: DatabaseEnvironment = process.env) {
  if (environment.NODE_ENV === 'test' && environment.DATABASE_ALLOW_PRIVILEGED_TEST_ROLE === 'true') return;
  const [row] = await client.$queryRaw<Array<{ currentUser: string; isSuperuser: boolean; isDatabaseOwner: boolean; canUpdate: boolean; canDelete: boolean; canTruncate: boolean }>>`
    SELECT current_user AS "currentUser", roles.rolsuper AS "isSuperuser",
      current_user = pg_get_userbyid(databases.datdba) AS "isDatabaseOwner",
      has_table_privilege(current_user, '"MetricSnapshot"', 'UPDATE') AS "canUpdate",
      has_table_privilege(current_user, '"MetricSnapshot"', 'DELETE') AS "canDelete",
      has_table_privilege(current_user, '"MetricSnapshot"', 'TRUNCATE') AS "canTruncate"
    FROM pg_database databases JOIN pg_roles roles ON roles.rolname = current_user
    WHERE databases.datname = current_database()`;
  if (!row || row.isSuperuser || row.isDatabaseOwner || row.canUpdate || row.canDelete || row.canTruncate) throw new Error('database runtime role is not safely restricted');
}
export type DatabaseClient = PrismaClient;
export type TransactionClient = Prisma.TransactionClient;
