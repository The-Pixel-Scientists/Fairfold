#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Runs once, as the superuser, when the Postgres container creates its data
# directory. It applies part 1 of the roles script
# (packages/db/scripts/roles.sql, copied to /pixelgrant/roles.sql) in the
# default database. `pnpm db:migrate` runs both parts again before
# migrating, and part 2 in each PixelGrant database.
#
# Each role password comes from the container's environment, either in
# PIXELGRANT_DB_<ROLE>_PASSWORD or in a file named by
# PIXELGRANT_DB_<ROLE>_PASSWORD_FILE. It is turned into a SCRAM-SHA-256
# verifier here, as packages/db/scripts/scram.ts does, so the password never
# reaches the server, and psql sends each verifier as a bound parameter, so
# it is never part of SQL text. A development password (ending
# "not-a-secret") is refused unless PIXELGRANT_DEV=1; this script only ever
# reaches the server in its own container, through the local socket.
#
# The development image installs this script as executable, so the
# entrypoint runs it rather than sourcing it. The work is in a subshell all
# the same, so it cannot change the entrypoint's shell options if a
# different image sources it. A failure fails the container's first start.

(
  set -eu

  read_secret() {
    name=$1
    eval "value=\${$name:-}"
    eval "file=\${${name}_FILE:-}"
    if [ -n "$value" ] && [ -n "$file" ]; then
      echo "10-roles.sh: set $name or ${name}_FILE, not both." >&2
      exit 1
    fi
    if [ -n "$file" ]; then
      value=$(cat "$file")
    fi
    if [ "${#value}" -lt 16 ]; then
      echo "10-roles.sh: set $name or ${name}_FILE to at least 16 characters." >&2
      exit 1
    fi
    case "$value" in
      *not-a-secret)
        if [ "${PIXELGRANT_DEV:-}" != 1 ]; then
          echo "10-roles.sh: $name is a development password. Set a real one outside development." >&2
          exit 1
        fi
        ;;
    esac
    printf '%s' "$value"
  }

  # SCRAM-SHA-256 verifier in PostgreSQL's stored format (RFC 5802, 7677),
  # with PostgreSQL's default 4096 iterations and a 16-byte random salt. The
  # password is passed in the environment, never on a command line.
  scram_verifier() {
    PIXELGRANT_SCRAM_PASSWORD=$1 perl -MDigest::SHA=hmac_sha256,sha256 -MMIME::Base64 -e '
      my $password = $ENV{PIXELGRANT_SCRAM_PASSWORD};
      die "Database passwords must use printable ASCII characters only.\n"
        unless $password =~ /\A[\x20-\x7e]+\z/;
      open my $random, "<:raw", "/dev/urandom" or die "Cannot read /dev/urandom\n";
      read($random, my $salt, 16) == 16 or die "Cannot read /dev/urandom\n";
      my $iterations = 4096;
      my $block = hmac_sha256($salt . pack("N", 1), $password);
      my $salted = $block;
      for (2 .. $iterations) {
        $block = hmac_sha256($block, $password);
        $salted ^= $block;
      }
      my $stored = sha256(hmac_sha256("Client Key", $salted));
      my $server = hmac_sha256("Server Key", $salted);
      my $b64 = sub { encode_base64($_[0], "") };
      print "SCRAM-SHA-256\$$iterations:", $b64->($salt), "\$", $b64->($stored), ":", $b64->($server);
    '
  }

  for role in MIGRATOR APP_API APP_WORKER APP_AUTH APP_QUEUE; do
    password=$(read_secret "PIXELGRANT_DB_${role}_PASSWORD")
    verifier=$(scram_verifier "$password")
    export "PIXELGRANT_DB_${role}_VERIFIER=$verifier"
  done
  unset password

  psql --no-psqlrc --no-password --set ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" --dbname "${POSTGRES_DB:-$POSTGRES_USER}" <<'SQL'
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_duration_sample = -1;
SET log_transaction_sample_rate = 0;
SET log_min_error_statement = panic;
SET log_parameter_max_length = 0;
SET log_parameter_max_length_on_error = 0;
\getenv verifier_migrator PIXELGRANT_DB_MIGRATOR_VERIFIER
\getenv verifier_app_api PIXELGRANT_DB_APP_API_VERIFIER
\getenv verifier_app_worker PIXELGRANT_DB_APP_WORKER_VERIFIER
\getenv verifier_app_auth PIXELGRANT_DB_APP_AUTH_VERIFIER
\getenv verifier_app_queue PIXELGRANT_DB_APP_QUEUE_VERIFIER
\o /dev/null
-- psql binds each value as it is: a verifier holds no spaces or quotes.
SELECT pg_catalog.set_config($1, $2, false) \bind pixelgrant.scram_verifier_migrator :verifier_migrator \g
SELECT pg_catalog.set_config($1, $2, false) \bind pixelgrant.scram_verifier_app_api :verifier_app_api \g
SELECT pg_catalog.set_config($1, $2, false) \bind pixelgrant.scram_verifier_app_worker :verifier_app_worker \g
SELECT pg_catalog.set_config($1, $2, false) \bind pixelgrant.scram_verifier_app_auth :verifier_app_auth \g
SELECT pg_catalog.set_config($1, $2, false) \bind pixelgrant.scram_verifier_app_queue :verifier_app_queue \g
\o
\unset verifier_migrator
\unset verifier_app_api
\unset verifier_app_worker
\unset verifier_app_auth
\unset verifier_app_queue
\i /pixelgrant/roles.sql
SQL
)
