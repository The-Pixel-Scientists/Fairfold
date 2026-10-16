-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0008, down: remove app.file and its trigger functions.
--
-- Dropping the table removes its rows, policies, triggers, constraints and
-- grants. Rows cannot come back, and the objects they named stay in
-- storage, so outside development the rollback for this migration is a
-- restore from backup. Nothing cascades: while a later migration's objects
-- still refer to app.file, this fails and changes nothing.

DROP TABLE app.file;
DROP FUNCTION app.record_file_scan();
DROP FUNCTION app.start_file_scan();
