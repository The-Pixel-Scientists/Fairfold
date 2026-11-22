# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Shared by provision.sh and load.sh: the tenant's BI key, and passwords read
# from files. A password never comes from an argument or PGPASSWORD.

# Files removed when the script ends: a private PGPASSFILE, a copied snapshot.
cleanup=()
trap 'rm -f "${cleanup[@]}"' EXIT

fail() {
  echo "$*" >&2
  exit 1
}

# TPS_BI_TENANT names the tenant's databases and roles (tps_bi_<key>_...).
# Every role on the server can see the names, so the key is opaque: never
# the tenant's name.
require_tenant_key() {
  [[ "${TPS_BI_TENANT:-}" =~ ^[a-z][a-z0-9]{0,29}$ ]] \
    || fail 'Set TPS_BI_TENANT to the tenant'\''s BI key: a lower-case letter, then up to 29 lower-case letters or digits.'
}

# The password in the file the variable $1 names: printable ASCII, at least 16 characters.
read_password() {
  local file=${!1:-} value LC_ALL=C
  [ -n "$file" ] && [ -r "$file" ] || fail "Set $1 to a readable file that holds the password."
  value=$(cat "$file")
  [[ "$value" =~ ^[\ -~]{16,}$ ]] || fail "The file $1 names must hold at least 16 printable ASCII characters."
  printf '%s' "$value"
}

# Gives psql the password in the file $1 names, through a private PGPASSFILE
# that is removed on exit, or else uses the PGPASSFILE already set. The
# private file matches only PGHOST, PGPORT, PGUSER and the databases named
# after $1, so psql never sends the password anywhere else.
use_password_file() {
  [ -z "${PGPASSWORD:-}" ] || fail 'Put the password in a file, not in PGPASSWORD.'
  if [ -z "${!1:-}" ]; then
    [ -n "${PGPASSFILE:-}" ] || fail "Set $1 or PGPASSFILE."
    return
  fi
  [ -n "${PGHOST:-}" ] && [ -n "${PGUSER:-}" ] || fail 'Set PGHOST to the BI server, and PGUSER.'
  local password database
  password=$(read_password "$1")
  PGPASSFILE=$(mktemp)
  cleanup+=("$PGPASSFILE")
  for database in "${@:2}"; do
    printf '%s:%s:%s:%s:%s\n' "$(pgpass_field "$PGHOST")" "$(pgpass_field "${PGPORT:-5432}")" \
      "$(pgpass_field "$database")" "$(pgpass_field "$PGUSER")" "$(pgpass_field "$password")"
  done > "$PGPASSFILE"
  export PGPASSFILE
}

pgpass_field() {
  sed 's/[\\:]/\\&/g' <<< "$1"
}

bi_psql() {
  psql --no-psqlrc --no-password --quiet --set ON_ERROR_STOP=1 "$@"
}
