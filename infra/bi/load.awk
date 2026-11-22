# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Passes a warehouse snapshot to psql only if it has exactly the structure the
# platform writes (apps/api/src/platform/warehouse/script.ts), so a damaged or
# altered file can run no psql command and no other SQL. It follows the
# statements as psql reads them: the opening before BEGIN, then between
# statements, inside a CREATE TABLE (its columns, then its key), or in COPY
# data, which ends only at a line that is exactly "\.". A carriage return is
# refused anywhere: copyValue() escapes it, so a real snapshot never holds
# one. Just after the snapshot's BEGIN it includes load.sql (the variable
# prepare) and turns on psql's restricted mode with the variable key, so psql
# refuses any backslash command after that. It sends COMMIT only once the
# whole file has passed. The header, lines 1 to 4, is checked by load.sh.

function refuse(why) {
  printf "The snapshot was not loaded: line %d %s.\n", NR, why > "/dev/stderr"
  refused = 1
  exit 1
}

BEGIN {
  state = "opening"
  if (key !~ /^[0-9a-f]+$/ || length(key) != 32) {
    print "The snapshot was not loaded: load.awk needs a random key." > "/dev/stderr"
    refused = 1
    exit 1
  }
}

index($0, "\r") { refuse("holds a carriage return") }
state == "copy" {
  if ($0 == "\\.") state = "between"
  print
  next
}
NR <= 4 { print; next }
state == "opening" && ($0 == "" || $0 == "SET client_encoding = 'UTF8';") { print; next }
state == "opening" && $0 == "BEGIN;" {
  state = "between"
  print
  printf "\\i '%s'\n\\restrict %s\n", prepare, key
  next
}
state == "opening" { refuse("is not part of a snapshot's opening") }
state == "committed" { refuse("comes after the snapshot's COMMIT") }
state == "between" && $0 == "" { print; next }
state == "between" && $0 == "COMMIT;" { state = "committed"; next }
state == "between" && /^CREATE TABLE "[a-z][a-z0-9_]*" \($/ { state = "columns"; print; next }
state == "between" && /^COPY "[a-z][a-z0-9_]*" \("[a-z][a-z0-9_]*"(, "[a-z][a-z0-9_]*")*\) FROM stdin;$/ {
  state = "copy"
  print
  next
}
state == "columns" && /^  "[a-z][a-z0-9_]*" [a-z]+( NOT NULL)?,$/ { print; next }
state == "columns" && /^  PRIMARY KEY \("[a-z][a-z0-9_]*"\)$/ { state = "key"; print; next }
state == "key" && $0 == ");" { state = "between"; print; next }
{ refuse("is not what a snapshot holds at that point") }

END {
  if (refused) exit 1
  if (state != "committed") {
    print "The snapshot was not loaded: it ends before its COMMIT." > "/dev/stderr"
    exit 1
  }
  print "COMMIT;"
}
