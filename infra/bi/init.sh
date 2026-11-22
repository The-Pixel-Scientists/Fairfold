#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The BI init job (ADR 0039), run on install and on every upgrade before the
# web server starts: Superset's own migrations, its built-in roles and
# permissions, then the starter dashboards.
set -eu
superset db upgrade
superset init
python /app/bi/import_dashboards.py
