#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The BI service's tests (ADR 0039), on Docker alone, in containers and
# networks of their own that are removed when it ends:
# - the stack's Compose file renders with and without compose.bi.yaml, and
#   the overlay keeps every BI service on its own networks;
# - two synthetic tenants are provisioned on one BI PostgreSQL server and
#   loaded from snapshots that the platform's own snapshot code wrote;
# - an altered snapshot neither loads nor runs a psql command;
# - tenant a's roles cannot reach tenant b's warehouse or the server's own
#   databases, the read-only role cannot create, write (a large object
#   included) or read outside schema warehouse, and a reload removes an
#   organisation erased since the last snapshot;
# - every starter dataset's SQL runs against the published tables only, and
#   the bundle targets the published contract versions;
# - from the BI network, the BI server is reachable, and an application
#   database and the metadata address are not;
# - in the BI image, the dashboards import twice with the same result, as a
#   user nobody can sign in as, and the tool refuses anyone not signed in.
#
#   TPS_BI_IMAGE=<BI image> infra/bi/test.sh
#
# TPS_BI_IMAGE is the image built from infra/bi/Dockerfile. On a machine
# without it, TPS_BI_DATABASE_ONLY=1 runs every step but the last and says
# so. TPS_BI_POSTGRES_IMAGE overrides the BI PostgreSQL image. Needs docker
# and Node.js on PATH.

set -euo pipefail
shopt -s inherit_errexit
cd "$(git rev-parse --show-toplevel)"
# Docker is given container paths only; Git Bash on Windows must not rewrite them.
export MSYS_NO_PATHCONV=1

postgres_image=${TPS_BI_POSTGRES_IMAGE:-postgres:16.15-bookworm@sha256:efedf3595f1d6f415c08568ba171029bf54052e754cc9f030e3f2412b21f3d67}
if [ -z "${TPS_BI_IMAGE:-}" ] && [ "${TPS_BI_DATABASE_ONLY:-}" != 1 ]; then
  echo 'Set TPS_BI_IMAGE to the BI image, or TPS_BI_DATABASE_ONLY=1 to skip the Superset steps.' >&2
  exit 1
fi
run=tps-bi-test-$$
work=$(mktemp -d)
tenant_a=11111111-1111-4111-8111-111111111111
tenant_b=22222222-2222-4222-8222-222222222222

cleanup() {
  status=$?
  docker rm --force "$run-postgres" "$run-app" "$run-client" "$run-init" "$run-web" > /dev/null 2>&1 || true
  docker network rm "$run-bi" "$run-app" > /dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo '--- The Compose overlay'
export TPS_STACK_CONSOLE_PORT=1 TPS_STACK_PORTAL_PORT=2 TPS_STACK_HTTP_PORT=3 TPS_STACK_MAIL_PORT=4
export TPS_STACK_WEB_NETWORK=tps-bi-test-web TPS_BI_TENANT=a TPS_BI_PORT=5
export TPS_BI_OIDC_ISSUER=https://idp.invalid TPS_BI_OIDC_CLIENT_ID=bi
export TPS_BI_ADMIN_GROUP=bi-admins TPS_BI_VIEWER_GROUP=bi-viewers
stack=infra/compose/compose.stack.yaml
docker compose --file "$stack" config --quiet
docker compose --file "$stack" --file infra/compose/compose.bi.yaml config --quiet
docker compose --file "$stack" --file infra/compose/compose.bi.yaml --profile load config --format json \
  | node infra/bi/tools.ts compose

echo '--- The bundle targets the published contracts'
node infra/bi/tools.ts contract

echo '--- Start a BI PostgreSQL server, and an application one on another network'
umask 077
mkdir "$work/secrets" "$work/bi"
for name in postgres a-owner a-reader a-superset b-owner b-reader b-superset secret-key oidc; do
  openssl rand -hex 24 | tr -d '\r\n' > "$work/secrets/$name"
done
# Throwaway secrets, copied into containers that run as other users. Each
# archive makes them readable to all (chmod has no effect in Git Bash).
ship() {
  tar -C "$work" --mode=a+rX -cf - "$@"
}
cp infra/bi/*.sh infra/bi/*.sql infra/bi/*.awk "$work/bi/"
node infra/bi/tools.ts snapshot "$tenant_a" 12 > "$work/bi/a.sql"
node infra/bi/tools.ts snapshot "$tenant_a" 11 > "$work/bi/a-erased.sql"
node infra/bi/tools.ts snapshot "$tenant_b" 8 > "$work/bi/b.sql"
node infra/bi/tools.ts explain > "$work/bi/explain.sql"

docker network create --internal "$run-bi" > /dev/null
docker network create --internal "$run-app" > /dev/null
docker create --name "$run-postgres" --network "$run-bi" --network-alias bi-postgres \
  --env POSTGRES_PASSWORD_FILE=/run/secrets/postgres "$postgres_image" > /dev/null
ship secrets | docker cp - "$run-postgres:/run"
docker start "$run-postgres" > /dev/null
docker run --detach --name "$run-app" --network "$run-app" --env POSTGRES_PASSWORD=not-used-here \
  "$postgres_image" > /dev/null
docker run --detach --name "$run-client" --network "$run-bi" --env PGHOST=bi-postgres \
  "$postgres_image" sleep infinity > /dev/null
ship secrets bi | docker cp - "$run-client:/"
for _ in $(seq 60); do
  docker exec "$run-postgres" pg_isready --quiet --username postgres && break
  sleep 1
done

client() {
  docker exec "$@"
}
# psql as a tenant's role: sql_as <tenant> <role> <database> [psql arguments]
sql_as() {
  local tenant=$1 role=$2 database=$3
  shift 3
  client --env PGUSER="tps_bi_${tenant}_${role}" --env PGDATABASE="tps_bi_${tenant}_${database}" \
    --env PGPASSWORD="$(cat "$work/secrets/$tenant-$role")" "$run-client" \
    psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 "$@"
}
refused() {
  if sql_as "$@" > /dev/null 2>&1; then fail "allowed: ${*: -1}"; fi
}

provision() {
  client --env TPS_BI_TENANT="$1" --env PGUSER=postgres \
    --env TPS_BI_ADMIN_PASSWORD_FILE=/secrets/postgres \
    --env TPS_BI_OWNER_PASSWORD_FILE="/secrets/$1-owner" \
    --env TPS_BI_READER_PASSWORD_FILE="/secrets/$1-reader" \
    --env TPS_BI_SUPERSET_PASSWORD_FILE="/secrets/$1-superset" \
    "$run-client" bash /bi/provision.sh > /dev/null
}

echo '--- Provision tenants a and b, twice'
for tenant in a b a b; do
  provision "$tenant"
done

load() {
  client --interactive --env TPS_BI_TENANT="$1" --env TPS_BI_TENANT_ID="$2" \
    --env TPS_BI_OWNER_PASSWORD_FILE="/secrets/$1-owner" "$run-client" bash /bi/load.sh - < "$work/bi/$3"
}

echo '--- Load the snapshots'
load a "$tenant_a" a.sql > /dev/null
load b "$tenant_b" b.sql > /dev/null
[ "$(sql_as a reader warehouse --command 'SELECT count(*) FROM organisation')" = 12 ] || fail 'tenant a has the wrong rows'
[ "$(sql_as b reader warehouse --command 'SELECT count(*) FROM organisation')" = 8 ] || fail 'tenant b has the wrong rows'
if load a "$tenant_a" b.sql > /dev/null 2>&1; then fail "tenant b's snapshot loaded into tenant a"; fi
sed 's/^BEGIN;$/BEGIN;\n\\! echo hostile/' "$work/bi/a.sql" > "$work/bi/a-hostile.sql"
if load a "$tenant_a" a-hostile.sql > /dev/null 2>&1; then fail 'a snapshot with a psql command loaded'; fi
# Two files that once made the line check and psql disagree on where COPY
# data or a statement ends: CRLF data with a "\." ending in CR, and a COPY
# line inside an open CREATE TABLE. Neither may load or run its command.
awk '/^COPY / && !done { copy = 1; print; next }
  copy && $0 == "\\." { print "\\.\r"; print "\\! id > /tmp/tps-bi-crlf"; copy = 0; done = 1; next }
  copy { print $0 "\r"; next }
  { print }' "$work/bi/a.sql" > "$work/bi/a-crlf.sql"
sed 's/^BEGIN;$/BEGIN;\nCREATE TABLE "x" (\nCOPY "y" ("a") FROM stdin;\n\\! id > \/tmp\/tps-bi-bracket/' \
  "$work/bi/a.sql" > "$work/bi/a-bracket.sql"
key=$(printf '%032d' 0)
check_lines() {
  client --interactive "$run-client" awk -v prepare=/bi/load.sql -v key="$key" -f /bi/load.awk - < "$work/bi/$1"
}
for name in crlf bracket; do
  if load a "$tenant_a" "a-$name.sql" > /dev/null 2>&1; then fail "the $name snapshot loaded"; fi
  if client "$run-client" test -e "/tmp/tps-bi-$name"; then fail "the $name snapshot ran a shell command"; fi
  # load.awk refuses each by itself too, whatever load.sh checks first.
  if check_lines "a-$name.sql" > /dev/null 2>&1; then fail "load.awk passed the $name snapshot"; fi
done
check_lines a.sql | grep -Fx "\\restrict $key" > /dev/null || fail 'load.awk does not turn on restricted mode'
sed '$d' "$work/bi/a.sql" | sed '$d' > "$work/bi/a-cut.sql"
if load a "$tenant_a" a-cut.sql > /dev/null 2>&1; then fail 'a snapshot cut short loaded'; fi
sed '3s/.*/-- Created: 2026-01-01T09:00:00.000Z/' "$work/bi/a.sql" > "$work/bi/a-old.sql"
if load a "$tenant_a" a-old.sql > /dev/null 2>&1; then fail 'a snapshot over 30 days old loaded'; fi
[ "$(sql_as a reader warehouse --command 'SELECT count(*) FROM organisation')" = 12 ] \
  || fail 'a refused load changed the warehouse'

echo '--- A reload replaces every row'
erased=$(sql_as a reader warehouse --command "SELECT id FROM organisation WHERE name = 'Synthetic organisation 12'")
load a "$tenant_a" a-erased.sql > /dev/null
[ "$(sql_as a reader warehouse --command "SELECT count(*) FROM organisation WHERE id = '$erased'")" = 0 ] \
  || fail 'the erased organisation survived the reload'

echo '--- The read-only role reads the warehouse and nothing else'
sql_as a reader warehouse --command 'SELECT count(*) FROM grants_application, _snapshot' > /dev/null
# Each check first turns off the read-only default, so the privileges alone refuse it.
writable=(--command 'SET default_transaction_read_only = off')
refused a reader warehouse "${writable[@]}" --command 'CREATE TABLE warehouse.x (y int)'
refused a reader warehouse "${writable[@]}" --command 'CREATE TABLE public.x (y int)'
refused a reader warehouse "${writable[@]}" --command 'CREATE TEMP TABLE x (y int)'
refused a reader warehouse "${writable[@]}" --command 'CREATE SCHEMA x'
refused a reader warehouse "${writable[@]}" --command 'DELETE FROM organisation'
refused a reader warehouse "${writable[@]}" --command "INSERT INTO person VALUES (gen_random_uuid(), 'active', now())"
refused a reader warehouse "${writable[@]}" --command 'CREATE EXTENSION dblink'
refused a reader warehouse --command "SELECT pg_read_file('/etc/passwd')"
refused a reader warehouse --command 'SELECT count(*) FROM pg_catalog.pg_authid'
refused a reader warehouse --command "SELECT set_config('default_transaction_read_only', 'off', false)" \
  --command "SELECT lo_from_bytea(0, 'x')"
refused a reader warehouse "${writable[@]}" --command 'SELECT lo_create(0)'
refused a owner warehouse --command "SELECT lo_from_bytea(0, 'x')"
refused a owner warehouse --command 'CREATE SCHEMA x'
# One made before these grants stops a load until provisioning removes it.
client --env PGUSER=postgres --env PGDATABASE=tps_bi_a_warehouse --env PGPASSWORD="$(cat "$work/secrets/postgres")" \
  "$run-client" psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 --command "SELECT lo_from_bytea(0, 'x')" > /dev/null
if load a "$tenant_a" a-erased.sql > /dev/null 2>&1; then fail 'a load ran beside a large object'; fi
provision a
load a "$tenant_a" a-erased.sql > /dev/null
[ "$(sql_as a reader warehouse --command 'SELECT count(*) FROM pg_largeobject_metadata')" = 0 ] \
  || fail 'the warehouse holds a large object'
for role in owner reader superset; do
  for database in postgres template1; do
    refused a "$role" warehouse --dbname "$database" --command 'SELECT 1'
  done
done
[ "$(sql_as a reader warehouse --command "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname LIKE 'tps_bi_%'")" = 0 ] \
  || fail 'a BI role belongs to another role'

echo '--- Tenant a cannot reach tenant b'
refused a reader warehouse --dbname tps_bi_b_warehouse --command 'SELECT 1'
refused a owner warehouse --dbname tps_bi_b_warehouse --command 'SELECT 1'
refused a superset metadata --dbname tps_bi_b_metadata --command 'SELECT 1'
refused a superset metadata --dbname tps_bi_a_warehouse --command 'SELECT 1'
refused a reader warehouse --dbname tps_bi_a_metadata --command 'SELECT 1'

echo '--- Every starter dataset reads published tables and columns only'
sql_as a reader warehouse --file /bi/explain.sql > /dev/null
refused a reader warehouse --command 'EXPLAIN SELECT o.region FROM warehouse.organisation AS o'

echo '--- From the BI network'
app=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$run-app")
reaches() {
  client "$run-client" timeout 3 bash -c "exec 3<> /dev/tcp/$1/$2" 2> /dev/null
}
reaches bi-postgres 5432 || fail 'the BI server is not reachable'
if reaches "$app" 5432; then fail 'the application database is reachable'; fi
if reaches 169.254.169.254 80; then fail 'the metadata address is reachable'; fi

if [ -z "${TPS_BI_IMAGE:-}" ]; then
  echo 'Passed, without the Superset steps: set TPS_BI_IMAGE to run them.'
  exit 0
fi

echo '--- Import the starter dashboards twice'
superset() {
  docker "$1" --name "$run-${2:-init}" --network "$run-bi" --env TPS_BI_TENANT=a \
    --env TPS_BI_DB_HOST=bi-postgres --env TPS_BI_DB_PORT=5432 --env TPS_BI_DB_SSLMODE=disable \
    --env TPS_BI_METADATA_PASSWORD_FILE=/run/secrets/a-superset \
    --env TPS_BI_WAREHOUSE_PASSWORD_FILE=/run/secrets/a-reader \
    --env TPS_BI_SECRET_KEY_FILE=/run/secrets/secret-key \
    --env TPS_BI_OIDC_CLIENT_SECRET_FILE=/run/secrets/oidc \
    --env TPS_BI_OIDC_ISSUER --env TPS_BI_OIDC_CLIENT_ID \
    --env TPS_BI_ADMIN_GROUP --env TPS_BI_VIEWER_GROUP "${@:3}"
}
imported() {
  sql_as a superset metadata --command "SELECT md5(string_agg(row, '|' ORDER BY row)) FROM (
    SELECT concat_ws(',', uuid, database_name, sqlalchemy_uri, allow_dml) AS row FROM dbs
    UNION ALL SELECT concat_ws(',', uuid, table_name, sql) FROM tables
    UNION ALL SELECT concat_ws(',', uuid, slice_name, params) FROM slices
    UNION ALL SELECT concat_ws(',', uuid, dashboard_title, position_json, json_metadata) FROM dashboards) AS rows"
}
# Prints only the fingerprint: the job's own output, which differs on a first
# run, goes to standard error.
import_once() {
  superset create init "$TPS_BI_IMAGE" /app/bi/init.sh > /dev/null
  ship secrets | docker cp - "$run-init:/run"
  docker start --attach "$run-init" >&2 || fail 'the init job failed'
  docker rm "$run-init" > /dev/null
  imported
}
first=$(import_once)
[ "$(sql_as a superset metadata --command 'SELECT count(*) FROM dashboards')" = 3 ] || fail 'the dashboards were not imported'
second=$(import_once)
[ "$second" = "$first" ] || fail 'the second import changed something'
[ "$(sql_as a superset metadata --command "SELECT count(*) FROM ab_user
  WHERE username = 'tps-bi-importer' AND NOT active AND password = '!'")" = 1 ] \
  || fail 'the import user is active or has a password'

echo '--- The tool needs sign-in'
superset create web "$TPS_BI_IMAGE" > /dev/null
ship secrets | docker cp - "$run-web:/run"
docker start "$run-web" > /dev/null
status() {
  docker exec "$run-web" python -c "
import sys, urllib.error, urllib.request
class Stay(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None
request = urllib.request.Request('http://127.0.0.1:8088$2', method='$1', data=b'{}' if '$1' == 'POST' else None,
                                 headers={'Content-Type': 'application/json'})
try: print(urllib.request.build_opener(Stay).open(request, timeout=5).status)
except urllib.error.HTTPError as error: print(error.code)
except OSError: print(0)"
}
for _ in $(seq 90); do
  [ "$(status GET /health)" = 200 ] && break
  sleep 2
done
[ "$(status GET /health)" = 200 ] || fail 'the tool did not start'
[ "$(status GET /superset/welcome/)" = 302 ] || fail 'the welcome page opened without sign-in'
[ "$(status GET /api/v1/dashboard/)" = 401 ] || fail 'the API answered without sign-in'
[[ "$(status POST /api/v1/database/)" =~ ^40[013]$ ]] || fail 'the database API took a change'
[ "$(status POST /api/v1/security/login)" != 200 ] || fail 'a password sign-in was accepted'

echo '--- The pages name no outside analytics host'
docker exec "$run-web" python -c "
import html, re, sys, urllib.error, urllib.request
class Stay(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None
for path in ('/superset/welcome/', '/login/'):
    try: response = urllib.request.build_opener(Stay).open('http://127.0.0.1:8088' + path, timeout=5)
    except urllib.error.HTTPError as error: response = error
    page = html.unescape(response.read().decode()) + str(response.headers)
    if re.search(r'scarf\.sh|\"SCARF_ANALYTICS\": *true', page, re.I): sys.exit(path + ' names an analytics host')
    policy = dict(part.strip().split(' ', 1) for part in response.headers['Content-Security-Policy'].split(';') if ' ' in part.strip())
    for directive in ('img-src', 'connect-src'):
        if set(policy[directive].split()) - {\"'self'\", 'data:', 'blob:'}: sys.exit(path + ' lets ' + directive + ' reach ' + policy[directive])
" || fail 'a page can send data to an outside host'
echo 'Passed.'
