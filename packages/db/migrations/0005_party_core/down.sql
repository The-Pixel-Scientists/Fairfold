-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0005, down: remove the party schema and everything in it.
--
-- Dropping a table removes its rows, policies, triggers, indexes and grants,
-- and dropping the schema removes app_api's USAGE. Rows cannot come back,
-- so outside development the rollback for this migration is a restore from
-- backup. Nothing cascades: while a later migration's objects still refer
-- to these, this fails and changes nothing.

DROP TABLE party.consent;
DROP TABLE party.relationship;
DROP TABLE party.person;
DROP TABLE party.organisation_identifier;
DROP FUNCTION party.unverify_changed_identifier();
DROP TABLE party.organisation;
DROP TABLE party.party;
DROP SCHEMA party;
