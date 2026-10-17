-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0013, down: remove publisher settings, decision emails,
-- decisions and the application withdrawal check.
--
-- Dropping a table removes its rows, policies, triggers, constraints,
-- indexes and grants. Rows cannot come back, so outside development the
-- rollback for this migration is a restore from backup. Nothing cascades:
-- while a later migration's objects still refer to these, this fails and
-- changes nothing.

DROP TABLE grants.publisher_setting;

DROP TABLE grants.decision_email;
DROP FUNCTION grants.record_decision_email_attempt();
DROP FUNCTION grants.check_decision_email();

DROP TRIGGER check_application_withdrawal ON grants.application;
DROP FUNCTION grants.check_application_withdrawal();

DROP TABLE grants.decision;
DROP FUNCTION grants.check_decision_change();
DROP FUNCTION grants.check_decision_application();
