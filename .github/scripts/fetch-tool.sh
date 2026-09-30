#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Download a CI tool's release file and check it against the SHA-256
# committed in .github/tool-checksums.sha256 (ADR 0002). Fails if the file has
# no committed checksum or does not match it.
#
#   .github/scripts/fetch-tool.sh <url> <directory>
#
# Updating a tool means updating its line in tool-checksums.sha256 in the
# same pull request.

set -euo pipefail

url=$1
directory=$2
file=${url##*/}
checksums="$(dirname "$0")/../tool-checksums.sha256"

expected=$(awk -v name="$file" '$2 == name { print $1 }' "$checksums")
if [ -z "$expected" ]; then
  echo "No committed checksum for $file in $checksums." >&2
  exit 1
fi

mkdir -p "$directory"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 3 \
  --output "$directory/$file" "$url"
echo "$expected  $directory/$file" | sha256sum --check --strict -
