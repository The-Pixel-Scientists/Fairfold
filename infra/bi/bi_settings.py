# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The settings superset_config.py and import_dashboards.py share, with no
# Superset import, so the import job can read them before the app starts.

import os
import re
from pathlib import Path
from urllib.parse import quote

# The role that may read the warehouse; import_dashboards.py grants it the
# warehouse connection.
VIEWER_ROLE = "Warehouse viewer"


def setting(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"Set {name}.")
    return value


def secret(name: str) -> str:
    value = Path(setting(name)).read_text(encoding="utf-8").strip()
    if len(value) < 16:
        raise RuntimeError(f"The file {name} names must hold at least 16 characters.")
    return value


TENANT = setting("TPS_BI_TENANT")
if not re.fullmatch(r"[a-z][a-z0-9]{0,29}", TENANT):
    raise RuntimeError("TPS_BI_TENANT must be a lower-case letter, then up to 29 lower-case letters or digits.")


def database_uri(kind: str, role: str, password: str) -> str:
    """A connection to one of the tenant's databases on the BI PostgreSQL server."""
    query = f"sslmode={quote(setting('TPS_BI_DB_SSLMODE'))}"
    if os.environ.get("TPS_BI_DB_SSLROOTCERT"):
        query += f"&sslrootcert={quote(os.environ['TPS_BI_DB_SSLROOTCERT'])}"
    return (
        f"postgresql+psycopg2://tps_bi_{TENANT}_{role}:{quote(password, safe='')}"
        f"@{setting('TPS_BI_DB_HOST')}:{int(setting('TPS_BI_DB_PORT'))}/tps_bi_{TENANT}_{kind}?{query}"
    )
