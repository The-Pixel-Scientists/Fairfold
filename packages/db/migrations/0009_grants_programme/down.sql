-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0009, down: remove the grants schema and everything in it.
--
-- Dropping a table removes its rows, policies, triggers, constraints,
-- indexes and grants, and dropping the schema removes app_api's USAGE.
-- Rows cannot come back, so outside development the rollback for this
-- migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these, this fails and changes nothing.

DROP TABLE grants.email_template_version;
DROP TABLE grants.rubric_criterion;
DROP TABLE grants.stage;
DROP TABLE grants.round;
DROP TABLE grants.programme;
DROP SCHEMA grants;
