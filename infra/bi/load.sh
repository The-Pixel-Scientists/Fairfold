#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Loads a tenant's warehouse snapshot (ADR 0016, ADR 0039) into its BI
# warehouse database, replacing every table there in one transaction, so
# people erased since the last snapshot are gone after this load. Or, with
# --empty, drops every warehouse table.
#
#   TPS_BI_TENANT=<key> TPS_BI_TENANT_ID=<tenant id> PGHOST=<BI server> \
#   TPS_BI_OWNER_PASSWORD_FILE=<file> infra/bi/load.sh <snapshot.sql>
#   TPS_BI_TENANT=<key> PGHOST=<BI server> TPS_BI_OWNER_PASSWORD_FILE=<file> \
#   infra/bi/load.sh --empty
#
# It connects to tps_bi_<key>_warehouse as tps_bi_<key>_owner, never as the
# read-only role, with the password from the file named, or from PGPASSFILE.
# It refuses a snapshot for another tenant, one older than 30 days, and any
# file that is not exactly what the platform writes (load.awk). It needs
# psql 16.10 or later, and PGHOST set to the BI server.

set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

require_tenant_key
export PGDATABASE="tps_bi_${TPS_BI_TENANT}_warehouse" PGUSER="tps_bi_${TPS_BI_TENANT}_owner"
use_password_file TPS_BI_OWNER_PASSWORD_FILE "$PGDATABASE"
snapshot=${1:?Name the snapshot file to load, or --empty.}

if [ "$snapshot" = --empty ]; then
  bi_psql --single-transaction --file "$here/load.sql"
  echo "The warehouse for $TPS_BI_TENANT is empty."
  exit 0
fi

uuid='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
[[ "${TPS_BI_TENANT_ID:-}" =~ $uuid ]] || fail "Set TPS_BI_TENANT_ID to the tenant's id."
if [ "$snapshot" = - ]; then
  snapshot=$(mktemp)
  cleanup+=("$snapshot")
  cat > "$snapshot"
fi
[ -f "$snapshot" ] && [ -r "$snapshot" ] || fail "Cannot read the snapshot $snapshot."
[[ "$here" != *"'"* ]] || fail 'Move infra/bi to a folder whose path has no quote mark.'
# A real snapshot holds neither, and awk implementations differ on NUL.
[ "$(tr -d '\r\000' < "$snapshot" | wc -c)" -eq "$(wc -c < "$snapshot")" ] \
  || fail "$snapshot holds a carriage return or a NUL byte, so it is not as downloaded. Nothing was loaded."

mapfile -t header < <(head -n 4 "$snapshot")
[ "${header[0]:-}" = '-- Warehouse snapshot' ] || fail "$snapshot is not a warehouse snapshot."
tenant=${header[1]#-- Tenant: }
created=${header[2]#-- Created: }
model=${header[3]#-- Model version: }
[[ "$tenant" =~ $uuid ]] && [[ "$created" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{8,12}Z$ ]] \
  && [[ "$model" =~ ^[1-9][0-9]{0,8}$ ]] || fail "The header of $snapshot is damaged."
[ "$tenant" = "$TPS_BI_TENANT_ID" ] \
  || fail "The snapshot is for tenant $tenant, not $TPS_BI_TENANT_ID. Nothing was loaded."

# The key for psql's restricted mode (psql 16.10 or later), which load.awk
# turns on once load.sql has run.
key=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
awk -v prepare="$here/load.sql" -v key="$key" -f "$here/load.awk" "$snapshot" \
  | bi_psql --set tenant="$tenant" --set created="$created" --set model="$model"
echo "Loaded the snapshot of $created (model version $model) into the warehouse for $TPS_BI_TENANT."
