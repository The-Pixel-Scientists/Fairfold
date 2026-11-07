-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0021, down: restore the checks from migrations 0002 and 0015, in
-- the reverse of the order up.sql widens them.
--
-- Row-level security hides every tenant's rows from migrator, so this cannot
-- look for offending rows first, but adding a check reads every row whatever
-- the policies. Each restore runs in a block that turns the check's
-- violation into a clear error, and the rollback then changes nothing. It
-- never deletes or rewrites data: change those roles or remove those
-- switches first, or restore the backup taken before the rollback (ADR 0003).

DO $restore$
BEGIN
  ALTER TABLE app.tenant_module DROP CONSTRAINT tenant_module_module_check;
  ALTER TABLE app.tenant_module ADD CONSTRAINT tenant_module_module_check
    CHECK (module IN ('grants'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0021 cannot be rolled back: tenant_module_module_check fails because a tenant still has a row for a wave 1 tool.'
    USING HINT = 'Remove those rows first, or restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

DO $restore$
BEGIN
  ALTER TABLE app.invitation DROP CONSTRAINT invitation_roles_check;
  ALTER TABLE app.invitation ADD CONSTRAINT invitation_roles_check CHECK (
    array_ndims(roles) = 1 AND cardinality(roles) > 0
    AND roles <@ ARRAY['tenant_admin', 'programme_manager', 'reviewer']);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0021 cannot be rolled back: invitation_roles_check fails because an invitation still holds due_diligence_officer, data_protection_lead or analyst.'
    USING HINT = 'Revoke or change those invitations first, or restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

DO $restore$
BEGIN
  ALTER TABLE app.membership DROP CONSTRAINT membership_roles_check;
  ALTER TABLE app.membership ADD CONSTRAINT membership_roles_check CHECK (
    array_ndims(roles) = 1 AND cardinality(roles) > 0
    AND roles <@ ARRAY['tenant_admin', 'programme_manager', 'reviewer', 'applicant']);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0021 cannot be rolled back: membership_roles_check fails because a membership still holds due_diligence_officer, data_protection_lead or analyst.'
    USING HINT = 'Change those memberships first, or restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;
