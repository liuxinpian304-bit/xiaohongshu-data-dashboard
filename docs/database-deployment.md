# Database deployment

Apply migrations with the owner-only `DATABASE_MIGRATION_URL`. Run API and worker processes only with the restricted `DATABASE_URL`; production must replace the example password.

The runtime role has no `UPDATE`, `DELETE`, or `TRUNCATE` privilege on `MetricSnapshot`. Corrections use the narrowly scoped `supersede_metric_snapshot` security-definer function. Deployment must verify all three privilege results below are false before application startup:

```sql
SELECT has_table_privilege(current_user, '"MetricSnapshot"', 'UPDATE'),
       has_table_privilege(current_user, '"MetricSnapshot"', 'DELETE'),
       has_table_privilege(current_user, '"MetricSnapshot"', 'TRUNCATE');
```

Never expose the migration-owner connection string to application containers.
