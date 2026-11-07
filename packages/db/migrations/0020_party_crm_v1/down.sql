-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0020, down: restore migration 0005's party.party and
-- party.organisation_identifier, and drop party.value_history, in the
-- reverse of the order up.sql adds them.
--
-- A merged party cannot be expressed without merged_into, so this refuses
-- while any party is merged, before it changes anything. Row-level security
-- hides every tenant's rows from migrator, but validating the restored
-- status check reads every row whatever the policies. Unmerge first, or
-- restore the backup taken before the rollback (ADR 0003). Dropping
-- party.value_history loses the history kept since 0020, and verifications
-- stay as they are; outside development the rollback for those is the
-- same backup.
DO $refuse$
BEGIN
  ALTER TABLE party.party DROP CONSTRAINT party_status_check;
  ALTER TABLE party.party
    ADD CONSTRAINT party_status_check CHECK (status IN ('active', 'archived'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0020 cannot be rolled back while a party is merged: dropping merged_into would lose its survivor.'
    USING HINT = 'Unmerge it first, or restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP TABLE party.value_history;
DROP FUNCTION party.set_changed_at();

-- Dropping the column removes app_api's UPDATE on it.
DROP TRIGGER refuse_merge_chain ON party.party;
DROP FUNCTION party.refuse_merge_chain();
DROP INDEX party.party_survivor;
ALTER TABLE party.party
  DROP CONSTRAINT party_merged_into_other,
  DROP CONSTRAINT party_merged_names_survivor,
  DROP CONSTRAINT party_merged_into,
  DROP COLUMN merged_into;

REVOKE UPDATE (verified_by) ON party.organisation_identifier FROM app_api;
DROP TRIGGER set_verified_at ON party.organisation_identifier;
DROP FUNCTION party.set_verified_at();
