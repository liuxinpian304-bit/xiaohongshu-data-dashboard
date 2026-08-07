import { PostgresCleanupStore, removeDemoContent } from './demo-content-cleanup';

const execute = process.argv.slice(2).includes('--execute');
const url = execute ? process.env.DATABASE_MAINTENANCE_URL : process.env.DATABASE_URL;
if (!url) throw new Error(execute ? 'DATABASE_MAINTENANCE_URL is required for execution' : 'DATABASE_URL is required');

const protectedXhsAccountId = '95874286519';
const store = new PostgresCleanupStore(url, protectedXhsAccountId);
try {
  const result = await removeDemoContent(store, { protectedXhsAccountId, execute });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await store.close();
}
