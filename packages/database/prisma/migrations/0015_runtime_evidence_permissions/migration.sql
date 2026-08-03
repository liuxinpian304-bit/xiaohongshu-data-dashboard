CREATE FUNCTION prevent_metric_snapshot_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'xhs_test_admin') THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'metric evidence is append-only and cannot be truncated';
END $$;
CREATE TRIGGER "MetricSnapshot_prevent_truncate" BEFORE TRUNCATE ON "MetricSnapshot"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_metric_snapshot_truncate();

CREATE OR REPLACE FUNCTION supersede_metric_snapshot(snapshot_id UUID, superseded_at TIMESTAMPTZ)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE "MetricSnapshot" SET "supersededAt" = superseded_at WHERE id = snapshot_id AND "supersededAt" IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'metric snapshot is not an active head'; END IF;
END $$;
REVOKE ALL ON FUNCTION supersede_metric_snapshot(UUID, TIMESTAMPTZ) FROM PUBLIC;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xhs_runtime') THEN CREATE ROLE xhs_runtime LOGIN PASSWORD 'runtime_change_me'; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO xhs_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO xhs_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO xhs_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON "MetricSnapshot" FROM xhs_runtime;
GRANT SELECT, INSERT ON "MetricSnapshot" TO xhs_runtime;
GRANT EXECUTE ON FUNCTION supersede_metric_snapshot(UUID, TIMESTAMPTZ) TO xhs_runtime;
