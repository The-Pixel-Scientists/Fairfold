-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0019, down: remove the application's snapshot key, then the
-- snapshots, in the reverse of the order up.sql adds them.
--
-- Dropping the column removes its grant, and dropping the table removes its
-- rows, policies, trigger and grants. Snapshots cannot come back, so
-- outside development the rollback for this migration is a restore from
-- backup.

DROP TRIGGER keep_application_snapshot ON grants.application;
DROP FUNCTION grants.keep_application_snapshot();
ALTER TABLE grants.application
  DROP CONSTRAINT application_organisation_snapshot,
  DROP CONSTRAINT application_snapshot_not_draft,
  DROP COLUMN organisation_snapshot_id;

DROP TRIGGER take_organisation_snapshot ON party.organisation_snapshot;
DROP TABLE party.organisation_snapshot;
DROP FUNCTION party.take_organisation_snapshot();
