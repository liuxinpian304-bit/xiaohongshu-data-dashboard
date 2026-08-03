# Database deployment

Set distinct strong `POSTGRES_PASSWORD` and `XHS_RUNTIME_PASSWORD` secrets before creating the Compose database. The initialization script passes the runtime secret as a psql variable and quotes it server-side; it creates or alters `xhs_runtime` without embedding a deployable password in the repository. URL-encode those secrets when constructing connection URLs.

Migration `0015_runtime_evidence_permissions` is immutable historical development SQL and briefly creates `xhs_runtime` with its former placeholder password. Migration `0017_account_revocation_operation` immediately sets that role's password to `NULL`, so a migrations-only database cannot authenticate with the placeholder. Never stop deployment between those migrations.

After **all** migrations finish, run `packages/database/docker/init-runtime-role.sh` with `POSTGRES_USER`, `POSTGRES_DB`, `PGHOST`, and the required `XHS_RUNTIME_PASSWORD`. This post-migration provision step sets the external secret and is required on fresh installs and upgrades. Only then start API and worker processes. The Compose database entrypoint may create the role before migrations, but `0017` deliberately invalidates that credential; run the same provision script again after `prisma migrate deploy`.

Apply migrations with the owner-only `DATABASE_MIGRATION_URL`. Run API and worker processes only with the restricted `DATABASE_URL`. `DATABASE_URL` is mandatory: there is no owner fallback. API and worker startup always verify the connected role. A privileged role can bypass the guard only when both `NODE_ENV=test` and `DATABASE_ALLOW_PRIVILEGED_TEST_ROLE=true`; never set that flag in a deployed process.

The runtime role has no `UPDATE`, `DELETE`, or `TRUNCATE` privilege on `MetricSnapshot`. Corrections use the narrowly scoped `supersede_metric_snapshot` security-definer function. Deployment must verify all three privilege results below are false before application startup:

```sql
SELECT has_table_privilege(current_user, '"MetricSnapshot"', 'UPDATE'),
       has_table_privilege(current_user, '"MetricSnapshot"', 'DELETE'),
       has_table_privilege(current_user, '"MetricSnapshot"', 'TRUNCATE');
```

Never expose the migration-owner connection string to application containers.
