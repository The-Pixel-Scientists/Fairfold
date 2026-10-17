-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0012, down: remove scores, conflict declarations, assignments
-- and reviewer pools.
--
-- Dropping a table removes its rows, policies, triggers, constraints,
-- indexes and grants. Rows cannot come back, so outside development the
-- rollback for this migration is a restore from backup. Nothing cascades:
-- while a later migration's objects still refer to these, this fails and
-- changes nothing.

DROP TABLE grants.score;
DROP FUNCTION grants.check_score_change();

DROP TABLE grants.conflict_declaration;
DROP FUNCTION grants.check_conflict_declaration();

DROP TABLE grants.assignment;
DROP FUNCTION grants.check_assignment_change();

DROP TABLE grants.reviewer;
