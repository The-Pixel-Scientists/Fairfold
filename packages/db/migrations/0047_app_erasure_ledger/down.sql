-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0047, down: drop the erasure ledger.
--
-- Rolling back loses the in-database ledger. Keep the off-site copies: they
-- are then the only ledger of who was erased. An erasure made while the
-- ledger is gone is in no ledger, so re-add it before any further erasure.
-- The owner roles stay: the roles script creates them, never a migration.

DROP TRIGGER record_erasure_in_ledger ON app.audit_event;
DROP FUNCTION app.record_erasure_in_ledger();
-- Dropping the table removes every right on it.
DROP TABLE app.erasure_ledger;
