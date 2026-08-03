# Database deployment

Set distinct strong `POSTGRES_PASSWORD` and `XHS_RUNTIME_PASSWORD` secrets before creating the Compose database. The initialization script passes the runtime secret as a psql variable and quotes it server-side; it creates or alters `xhs_runtime` without embedding a deployable password in the repository. URL-encode those secrets when constructing connection URLs.

For an upgrade from a development database that used the former example credential, run `packages/database/docker/init-runtime-role.sh` with `POSTGRES_USER`, `POSTGRES_DB`, `PGHOST`, and `XHS_RUNTIME_PASSWORD` set before starting application processes. Migration `0015_runtime_evidence_permissions` never creates or alters a credential; it fails when the externally provisioned role is absent, then only applies grants and revocations.

Apply migrations with the owner-only `DATABASE_MIGRATION_URL`. Run API and worker processes only with the restricted `DATABASE_URL`. `DATABASE_URL` is mandatory: there is no owner fallback. API and worker startup always verify the connected role. A privileged role can bypass the guard only when both `NODE_ENV=test` and `DATABASE_ALLOW_PRIVILEGED_TEST_ROLE=true`; never set that flag in a deployed process.

The runtime role has no `UPDATE`, `DELETE`, or `TRUNCATE` privilege on `MetricSnapshot`. Corrections use the narrowly scoped `supersede_metric_snapshot` security-definer function. Deployment must verify all three privilege results below are false before application startup:

```sql
SELECT has_table_privilege(current_user, '"MetricSnapshot"', 'UPDATE'),
       has_table_privilege(current_user, '"MetricSnapshot"', 'DELETE'),
       has_table_privilege(current_user, '"MetricSnapshot"', 'TRUNCATE');
```

Never expose the migration-owner connection string to application containers.
