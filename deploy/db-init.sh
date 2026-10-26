#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_user="$PM_DB_USER" --set=app_password="$PM_DB_PASSWORD" --set=ON_ERROR_STOP=1 <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_user', :'app_password') \gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user') \gexec
SQL
