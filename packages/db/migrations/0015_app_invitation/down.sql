-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0015, down: remove app.invitation and its trigger function.
--
-- Dropping the table removes its rows, policies, triggers, constraints and
-- grants. Rows cannot come back, so outside development the rollback for
-- this migration is a restore from backup. Memberships made by accepting an
-- invitation stay. Nothing cascades: while a later migration's objects still
-- refer to app.invitation, this fails and changes nothing.

DROP TABLE app.invitation;
DROP FUNCTION app.keep_final_invitation();
