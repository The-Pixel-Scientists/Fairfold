-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0011, down: remove applications, their eligibility checks,
-- stage history and file links.
--
-- Dropping a table removes its rows, policies, triggers, constraints,
-- indexes and grants. Rows cannot come back, so outside development the
-- rollback for this migration is a restore from backup. Nothing cascades:
-- while a later migration's objects still refer to these, this fails and
-- changes nothing.

DROP TABLE grants.application_file;
DROP FUNCTION grants.check_application_file();

DROP TABLE grants.stage_transition;
DROP TABLE grants.eligibility_result;
DROP TABLE grants.application;
DROP FUNCTION grants.check_application_change();
DROP FUNCTION grants.check_application_form();
