-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0026, down: remove the operator author, in the reverse of the
-- order up.sql adds it.
--
-- Row-level security hides every tenant's rows from migrator, so this cannot
-- look for operator rows first, but restoring NOT NULL reads every row
-- whatever the policies. Each restore runs in a block that turns the
-- violation into a clear error, and the rollback then changes nothing. It
-- never deletes or rewrites data: restore the backup taken before the
-- rollback instead (ADR 0003).

DO $restore$
BEGIN
  ALTER TABLE app.config_version
    DROP CONSTRAINT config_version_author,
    DROP COLUMN author_kind,
    ALTER COLUMN author_id SET NOT NULL;
EXCEPTION WHEN not_null_violation THEN
  RAISE EXCEPTION 'Migration 0026 cannot be rolled back: a configuration version has the operator as its author.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

DROP TRIGGER set_user_author ON app.tenant_module;
DROP FUNCTION app.set_user_author();

DO $restore$
BEGIN
  ALTER TABLE app.tenant_module
    DROP CONSTRAINT tenant_module_author,
    DROP COLUMN updated_by_kind,
    ALTER COLUMN updated_by SET NOT NULL;
EXCEPTION WHEN not_null_violation THEN
  RAISE EXCEPTION 'Migration 0026 cannot be rolled back: a module switch has the operator as its author.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

COMMENT ON TABLE app.tenant_module IS NULL;
