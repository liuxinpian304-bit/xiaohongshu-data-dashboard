import { afterAll, describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const databaseName = `xhs_observed_at_${process.pid}`;
const adminUrl = 'postgresql://postgres:postgres@localhost:55432/postgres';
const targetUrl = `postgresql://postgres:postgres@localhost:55432/${databaseName}`;

describe('0020 observedAt populated upgrade', () => {
  afterAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end();
  });

  it('backfills active and superseded evidence and restores immutable triggers', async () => {
    const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${databaseName}"`); await admin.end();
    const db = new pg.Client({ connectionString: targetUrl }); await db.connect();
    const migrations = fileURLToPath(new URL('../prisma/migrations', import.meta.url));
    for (const directory of (await readdir(migrations)).sort().filter((name) => name < '0020_')) {
      await db.query(await readFile(`${migrations}/${directory}/migration.sql`, 'utf8'));
    }
    const ids = { account: '00000000-0000-4000-8000-000000000001', note: '00000000-0000-4000-8000-000000000002', definition: '00000000-0000-4000-8000-000000000003', old: '00000000-0000-4000-8000-000000000004', active: '00000000-0000-4000-8000-000000000005' };
    await db.query(`INSERT INTO "Account" (id,"connectorType","platformId","updatedAt") VALUES ($1,'official','migration-account',now())`, [ids.account]);
    await db.query(`INSERT INTO "Note" (id,"accountId","connectorType","platformId",title,"publishedAt","updatedAt") VALUES ($1,$2,'official','migration-note','Migration',now(),now())`, [ids.note, ids.account]);
    await db.query(`INSERT INTO "MetricDefinition" (id,key,"displayName",unit,source,version,"effectiveFrom") VALUES ($1,'views','Views','count','official','official-v1','2026-01-01Z')`, [ids.definition]);
    await db.query(`INSERT INTO "MetricSnapshot" (id,"noteId","metricDefinitionId",availability,value,"capturedAt",source,"aggregationVersion",revision,"supersededAt") VALUES ($1,$2,$3,'available',10,'2026-08-01T15:59:59.999Z','official','official-v1',1,'2026-09-01Z')`, [ids.old, ids.note, ids.definition]);
    await db.query(`INSERT INTO "MetricSnapshot" (id,"noteId","metricDefinitionId",availability,value,"capturedAt",source,"aggregationVersion",revision,"supersedesId","correctedAt","correctionReason") VALUES ($1,$2,$3,'available',11,'2026-08-01T15:59:59.999Z','official','official-v1',2,$4,'2026-09-01Z','corrected')`, [ids.active, ids.note, ids.definition, ids.old]);
    const before = await db.query(`SELECT id,value,"capturedAt",source,"aggregation","aggregationVersion",revision,"supersedesId","supersededAt" FROM "MetricSnapshot" ORDER BY revision`);
    await db.query(await readFile(`${migrations}/0020_metric_snapshot_observed_at/migration.sql`, 'utf8'));
    const after = await db.query(`SELECT id,value,"capturedAt","observedAt",source,"aggregation","aggregationVersion",revision,"supersedesId","supersededAt" FROM "MetricSnapshot" ORDER BY revision`);
    expect(after.rows.map(({ observedAt, ...row }) => row)).toEqual(before.rows);
    expect(after.rows.every((row) => row.observedAt.getTime() === row.capturedAt.getTime())).toBe(true);
    await expect(db.query(`UPDATE "MetricSnapshot" SET value=99 WHERE id=$1`, [ids.active])).rejects.toThrow('immutable');
    await expect(db.query(`DELETE FROM "MetricSnapshot" WHERE id=$1`, [ids.old])).rejects.toThrow('append-only');
    await db.end();
  }, 30_000);
});
