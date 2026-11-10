#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Runs the backup job against a real PostgreSQL and S3 target, then restores
# its newest snapshot into a clean server and compares it with the source:
# row counts per tenant on every forced row-level security table, and every
# file hash in the manifest. Synthetic data only.
#
# Needs node, age, age-keygen, pg_restore, psql, createdb and the S3 client on
# PATH, and the job's settings (infra/backup/README.md) in the environment,
# except TPS_BACKUP_RECIPIENTS_FILE and TPS_BACKUP_KEY_ID, which are set here.
# The store must support object lock, and whatever it locks stays locked:
# point this only at a bucket you can abandon.
#
#   RESTORE_SOURCE_URL   superuser connection to the source database
#   RESTORE_TARGET_URLS  space-separated superuser connections to empty, clean
#                        PostgreSQL 16 and newest-major databases, with the
#                        roles script already run

set -euo pipefail

: "${RESTORE_SOURCE_URL:?Set RESTORE_SOURCE_URL.}"
: "${RESTORE_TARGET_URLS:?Set RESTORE_TARGET_URLS.}"

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

age-keygen -o "$work/key" 2>/dev/null
age-keygen -y "$work/key" >"$work/recipients"
export TPS_BACKUP_RECIPIENTS_FILE="$work/recipients"
export TPS_BACKUP_KEY_ID="restore-test"

node "$here/../src/main.ts"

aws_store() {
  AWS_SHARED_CREDENTIALS_FILE="$TPS_BACKUP_STORE_CREDENTIALS_FILE" \
    "$TPS_BACKUP_S3_CLIENT" --endpoint-url "$TPS_BACKUP_STORE_ENDPOINT" \
    --region "$TPS_BACKUP_STORE_REGION" "$@"
}

fetch() { # store-key output-file
  aws_store s3 cp --only-show-errors "s3://$TPS_BACKUP_STORE_BUCKET/$1" "$2"
}

newest=$(aws_store s3api list-object-versions --bucket "$TPS_BACKUP_STORE_BUCKET" \
  --prefix manifests/ --query 'Versions[?IsLatest].Key' --output text | tr '\t' '\n' | sort | tail -1)
[ -n "$newest" ] || { echo "No complete snapshot in the store." >&2; exit 1; }

fetch "$newest" "$work/manifest.age"
age --decrypt -i "$work/key" -o "$work/manifest.json" "$work/manifest.age"

field() { # expression over the parsed manifest `m`
  node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log($1)" "$work/manifest.json"
}

while read -r key sha; do
  fetch "$key" "$work/file.age"
  age --decrypt -i "$work/key" -o "$work/file" "$work/file.age"
  [ "$(sha256sum "$work/file" | cut -d' ' -f1)" = "$sha" ] || {
    echo "File hash mismatch: $key" >&2
    exit 1
  }
done < <(field "m.files.map(f=>f.object.key+' '+f.contentSha256).join('\n')")
echo "Every manifest file hash matches."

fetch "$(field 'm.dumps[0].object.key')" "$work/dump.age"
age --decrypt -i "$work/key" -o "$work/dump" "$work/dump.age"
fetch "$(field 'm.keySnapshot.key')" "$work/keys.age"
age --decrypt -i "$work/key" -o "$work/keys" "$work/keys.age"

counts_sql="SELECT format('SELECT %L, tenant_id, count(*) FROM %s GROUP BY tenant_id;', c.oid::regclass, c.oid::regclass)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
  WHERE c.relkind = 'r' AND c.relforcerowsecurity ORDER BY 1"

counts() { # url output-file
  psql "$1" -At -v ON_ERROR_STOP=1 -c "$counts_sql" |
    psql "$1" -At -v ON_ERROR_STOP=1 | sort >"$2"
}

counts "$RESTORE_SOURCE_URL" "$work/source.counts"
tenants=$(cut -d'|' -f2 "$work/source.counts" | sort -u | wc -l)
[ "$tenants" -ge 2 ] || { echo "The source needs at least two tenants." >&2; exit 1; }

for target in $RESTORE_TARGET_URLS; do
  pg_restore --no-owner --no-privileges --exit-on-error --dbname="$target" "$work/dump"
  pg_restore --data-only --disable-triggers --exit-on-error --dbname="$target" "$work/keys"
  counts "$target" "$work/target.counts"
  diff -u "$work/source.counts" "$work/target.counts"
  psql "$target" -At -c 'SHOW server_version' | sed 's/^/Row counts match on PostgreSQL /'
done
