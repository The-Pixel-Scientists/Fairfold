-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0065, down: restore the check from migration 0021.
--
-- Row-level security hides every tenant's rows from migrator, so this cannot
-- look for offending rows first, but adding a check reads every row whatever
-- the policies. The restore runs in a block that turns the check's violation
-- into a clear error, and the rollback then changes nothing. It never
-- deletes or rewrites data: remove those switches first, or restore the
-- backup taken before the rollback (ADR 0003).

DO $restore$
BEGIN
  ALTER TABLE app.tenant_module DROP CONSTRAINT tenant_module_module_check;
  ALTER TABLE app.tenant_module ADD CONSTRAINT tenant_module_module_check
    CHECK (module IN ('grants', 'crm', 'assure', 'forms', 'privacy', 'insight'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0065 cannot be rolled back: tenant_module_module_check fails because a tenant still has a row for the impact tool.'
    USING HINT = 'Remove those rows first, or restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;
