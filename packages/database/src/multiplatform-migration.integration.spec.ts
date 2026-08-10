import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const databaseName = `xhs_multiplatform_${process.pid}`;
const adminUrl = 'postgresql://postgres:postgres@localhost:55432/postgres';
const targetUrl = `postgresql://postgres:postgres@localhost:55432/${databaseName}`;
let activeClient: pg.Client | null = null;

describe('0022 multiplatform dimensions upgrade', () => {
  afterEach(async () => {
    await activeClient?.end().catch(() => undefined);
    activeClient = null;
  });

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  it('preserves Xiaohongshu ids and isolates matching Douyin remote ids', async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await admin.end();

    const db = new pg.Client({ connectionString: targetUrl });
    activeClient = db;
    await db.connect();
    const migrations = fileURLToPath(new URL('../prisma/migrations', import.meta.url));
    for (const directory of (await readdir(migrations)).sort().filter((name) => name < '0022_')) {
      await db.query(await readFile(`${migrations}/${directory}/migration.sql`, 'utf8'));
    }

    const ids = {
      account: '10000000-0000-4000-8000-000000000001',
      note: '10000000-0000-4000-8000-000000000002',
      comment: '10000000-0000-4000-8000-000000000003',
      definition: '10000000-0000-4000-8000-000000000004',
      douyinAccount: '10000000-0000-4000-8000-000000000005',
      mockAccount: '10000000-0000-4000-8000-000000000006',
    };
    await db.query(
      `INSERT INTO "Account" (id,"connectorType","platformId","updatedAt") VALUES ($1,'self-scrape','same-account',now())`,
      [ids.account],
    );
    await db.query(
      `INSERT INTO "Note" (id,"accountId","connectorType","platformId",title,"publishedAt","updatedAt") VALUES ($1,$2,'self-scrape','same-content','Legacy note',now(),now())`,
      [ids.note, ids.account],
    );
    await db.query(
      `INSERT INTO "Comment" (id,"noteId","connectorType","platformId",content,"publishedAt",source) VALUES ($1,$2,'self-scrape','same-comment','Legacy comment',now(),'self-scrape')`,
      [ids.comment, ids.note],
    );
    await db.query(
      `INSERT INTO "MetricDefinition" (id,key,"displayName",unit,source,version,"effectiveFrom") VALUES ($1,'views','Views','count','self-scrape','jsonl-v1','1970-01-01Z')`,
      [ids.definition],
    );

    await db.query(await readFile(`${migrations}/0022_multiplatform_dimensions/migration.sql`, 'utf8'));
    await db.query(await readFile(`${migrations}/0023_mock_platform_namespace/migration.sql`, 'utf8'));
    await db.query(await readFile(`${migrations}/0024_legacy_source_compatibility/migration.sql`, 'utf8'));

    const preserved = await db.query(
      `SELECT id,platform,source FROM "Account" WHERE id=$1`,
      [ids.account],
    );
    expect(preserved.rows).toEqual([{ id: ids.account, platform: 'xiaohongshu', source: 'self-scrape' }]);
    await db.query(
      `INSERT INTO "Account" (id,platform,source,"connectorType","platformId","updatedAt") VALUES ($1,'douyin','xiaohuohua','xiaohuohua','same-account',now())`,
      [ids.douyinAccount],
    );
    const accounts = await db.query(
      `SELECT platform,"platformId" FROM "Account" WHERE "platformId"='same-account' ORDER BY platform`,
    );
    expect(accounts.rows).toEqual([
      { platform: 'douyin', platformId: 'same-account' },
      { platform: 'xiaohongshu', platformId: 'same-account' },
    ]);
    await db.query(
      `INSERT INTO "Account" (id,platform,"connectorType","platformId","updatedAt") VALUES ($1,'xiaohongshu','mock','same-account',now())`,
      [ids.mockAccount],
    );
    expect((await db.query(`SELECT count(*)::int AS count FROM "Account" WHERE "platformId"='same-account'`)).rows).toEqual([{ count: 3 }]);
    expect((await db.query(`SELECT source FROM "Account" WHERE id=$1`, [ids.mockAccount])).rows).toEqual([{ source: 'mock' }]);
    expect((await db.query(`SELECT id,platform,source,"contentKind" FROM "Note" WHERE id=$1`, [ids.note])).rows).toEqual([
      { id: ids.note, platform: 'xiaohongshu', source: 'self-scrape', contentKind: 'note' },
    ]);
    expect((await db.query(`SELECT id,platform FROM "Comment" WHERE id=$1`, [ids.comment])).rows).toEqual([
      { id: ids.comment, platform: 'xiaohongshu' },
    ]);
    expect((await db.query(`SELECT id,platform FROM "MetricDefinition" WHERE id=$1`, [ids.definition])).rows).toEqual([
      { id: ids.definition, platform: 'xiaohongshu' },
    ]);
    await db.end();
    activeClient = null;
  }, 30_000);
});
