-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0095, down: remove approval decisions, in reverse order. Rows
-- cannot come back, so outside development the rollback is a restore from
-- backup. Nothing cascades: while a later migration's objects still refer to
-- the table, this fails and changes nothing.

DROP TABLE app.approval_decision;
DROP FUNCTION app.check_rejection_closed();
DROP FUNCTION app.check_approval_decision();
