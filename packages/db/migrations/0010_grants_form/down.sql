-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0010, down: remove grants.form_version.
--
-- Dropping the table removes its rows, policies, trigger, constraints,
-- indexes and grants. Rows cannot come back, so outside development the
-- rollback for this migration is a restore from backup. Nothing cascades:
-- while a later migration's objects still refer to it, this fails and
-- changes nothing.

DROP TABLE grants.form_version;
