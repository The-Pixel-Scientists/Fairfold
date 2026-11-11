-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0060, down: remove the reminder setting with its trigger and
-- function. Rows cannot come back, so outside development the rollback for
-- this migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to the table, this fails and changes nothing.

DROP TABLE grants.reminder_setting;
DROP FUNCTION grants.version_reminder_setting();
