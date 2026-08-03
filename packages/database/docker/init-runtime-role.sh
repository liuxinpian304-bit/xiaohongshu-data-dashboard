#!/bin/sh
set -eu

: "${XHS_RUNTIME_PASSWORD:?XHS_RUNTIME_PASSWORD is required}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=runtime_password="$XHS_RUNTIME_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE xhs_runtime LOGIN PASSWORD %L', :'runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xhs_runtime') \gexec
SELECT format('ALTER ROLE xhs_runtime LOGIN PASSWORD %L', :'runtime_password') \gexec
COMMENT ON ROLE xhs_runtime IS 'externally provisioned runtime credential';
SQL
