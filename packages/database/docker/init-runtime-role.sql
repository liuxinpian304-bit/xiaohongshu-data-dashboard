DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xhs_runtime') THEN CREATE ROLE xhs_runtime LOGIN PASSWORD 'runtime_change_me'; END IF;
END $$;
