# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Imports the starter dashboards (ADR 0039), run by init.sh on install and
# on every upgrade. It sets up the one database connection, to the tenant's
# warehouse as its read-only role with DML off, then imports the bundle in
# dashboards/ by UUID, overwriting the starter objects and touching nothing
# else, so a second run changes nothing and tenants' copies survive. It
# refuses a warehouse loaded from another model version than the bundle
# targets, and imports nothing until a snapshot is loaded. Superset checks
# the acting user's permissions while importing, so the import runs as a
# service user with the Admin role that is kept inactive with no usable
# password: nobody can sign in as it.

import sys
import uuid
from pathlib import Path

import yaml
from sqlalchemy import create_engine, text

from bi_settings import TENANT, VIEWER_ROLE, database_uri, secret

BUNDLE = Path(__file__).with_name("dashboards")
WAREHOUSE = "7abde56f-93f9-4e34-b8b0-b8781f25df49"
CONNECTION_FILE = "databases/warehouse.yaml"
IMPORTER = "tps-bi-importer"


def loaded_model_version(uri: str) -> int | None:
    engine = create_engine(uri)
    try:
        with engine.connect() as connection:
            if connection.execute(text("SELECT to_regclass('warehouse._snapshot')")).scalar() is None:
                return None
            return connection.execute(text("SELECT model_version FROM warehouse._snapshot")).scalar()
    finally:
        engine.dispose()


def main() -> int:
    target = yaml.safe_load((BUNDLE / "contract.yaml").read_text(encoding="utf-8"))["model_version"]
    password = secret("TPS_BI_WAREHOUSE_PASSWORD_FILE")
    loaded = loaded_model_version(database_uri("warehouse", "reader", password))
    if loaded is None:
        print("No snapshot is loaded yet, so no dashboards were imported. Load one, then run this again.")
        return 0
    if loaded != target:
        print(
            f"The loaded snapshot is model version {loaded}, but the starter dashboards target "
            f"version {target}. Load a snapshot from a matching release.",
            file=sys.stderr,
        )
        return 1

    from superset.app import create_app

    with create_app().app_context():
        from superset import db, security_manager
        from superset.commands.importers.v1.assets import ImportAssetsCommand
        from superset.constants import PASSWORD_MASK
        from superset.models.core import Database
        from superset.utils.core import override_user

        importer = security_manager.find_user(username=IMPORTER) or security_manager.user_model(
            username=IMPORTER, first_name="Dashboard", last_name="importer", email=f"{IMPORTER}@bi.invalid"
        )
        importer.active = False
        # Not a hash werkzeug recognises, so no password matches it.
        importer.password = "!"
        importer.roles = [security_manager.find_role("Admin")]
        db.session.add(importer)
        db.session.commit()

        contents = {
            path.relative_to(BUNDLE).as_posix(): path.read_text(encoding="utf-8")
            for path in sorted(BUNDLE.rglob("*.yaml"))
            if path.name != "contract.yaml"
        }
        contents[CONNECTION_FILE] = yaml.safe_dump(
            {
                "database_name": "Warehouse",
                "sqlalchemy_uri": database_uri("warehouse", "reader", PASSWORD_MASK),
                "cache_timeout": None,
                "expose_in_sqllab": True,
                "allow_run_async": False,
                "allow_ctas": False,
                "allow_cvas": False,
                "allow_dml": False,
                "allow_file_upload": False,
                "extra": {"allows_virtual_table_explore": True, "schemas_allowed_for_file_upload": []},
                "uuid": WAREHOUSE,
                "version": "1.0.0",
            }
        )
        with override_user(importer):
            ImportAssetsCommand(contents, passwords={CONNECTION_FILE: password}).run()

        database = db.session.query(Database).filter_by(uuid=uuid.UUID(WAREHOUSE)).one()
        role = security_manager.add_role(VIEWER_ROLE)
        access = security_manager.add_permission_view_menu("database_access", database.perm)
        security_manager.add_permission_role(role, access)
        db.session.commit()
    print(f"Imported the starter dashboards for {TENANT} at model version {target}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
