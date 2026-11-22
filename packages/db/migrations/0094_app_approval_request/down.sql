-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0094, down: remove approval requests. Rows cannot come back, so
-- outside development the rollback is a restore from backup. Nothing
-- cascades: while a later migration's decisions or a module's link table
-- still refer to the table, this fails and changes nothing.

DROP TABLE app.approval_request;
DROP FUNCTION app.check_approval_request();
