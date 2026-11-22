#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Creates or updates one tenant's BI databases and roles (provision.sql) on
# the BI PostgreSQL server, as its superuser. Safe to run again, and run
# again after changing a password. Never point it at the application's
# PostgreSQL server.
#
#   TPS_BI_TENANT=<key> PGHOST=<BI server> PGUSER=postgres \
#   TPS_BI_ADMIN_PASSWORD_FILE=<file> TPS_BI_OWNER_PASSWORD_FILE=<file> \
#   TPS_BI_READER_PASSWORD_FILE=<file> TPS_BI_SUPERSET_PASSWORD_FILE=<file> \
#   infra/bi/provision.sh
#
# Each role's password is turned into a SCRAM-SHA-256 verifier here, as
# infra/compose/postgres/initdb/10-roles.sh does, so no password reaches the
# server, and psql binds each verifier as a parameter.

set -euo pipefail
here=$(dirname "$0")
# shellcheck source=lib.sh
. "$here/lib.sh"

require_tenant_key
use_password_file TPS_BI_ADMIN_PASSWORD_FILE postgres \
  "tps_bi_${TPS_BI_TENANT}_warehouse" "tps_bi_${TPS_BI_TENANT}_metadata"

# PostgreSQL's stored format (RFC 5802, 7677), with its default 4096
# iterations and a 16-byte random salt. The password goes in the
# environment, never on a command line.
scram_verifier() {
  TPS_SCRAM_PASSWORD=$1 perl -MDigest::SHA=hmac_sha256,sha256 -MMIME::Base64 -e '
    my $password = $ENV{TPS_SCRAM_PASSWORD};
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

for role in OWNER READER SUPERSET; do
  password=$(read_password "TPS_BI_${role}_PASSWORD_FILE")
  verifier=$(scram_verifier "$password")
  export "TPS_BI_${role}_VERIFIER=$verifier"
done
unset password verifier

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
bi_psql --dbname postgres --set tenant="$TPS_BI_TENANT" --file "$here/provision.sql"
echo "The BI databases and roles for $TPS_BI_TENANT are ready."
