-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0055, down: remove screening runs, matches and decisions, in reverse order.
-- Rows cannot come back, so outside development the rollback for this
-- migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these tables, this fails and
-- changes nothing.

DROP TABLE assure.match_decision;
DROP FUNCTION assure.check_match_decision();
DROP TABLE assure.screening_match;
DROP FUNCTION assure.check_match_subject();
DROP TABLE assure.screening_run;
DROP FUNCTION assure.check_screening_run();
