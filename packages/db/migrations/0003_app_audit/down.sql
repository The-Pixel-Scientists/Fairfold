-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0003, down: remove the audit log, its trigger function and the
-- retention settings.
--
-- Dropping a table removes its rows, policies, triggers, indexes and grants.
-- Audit events cannot come back, so outside development the rollback for
-- this migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these, this fails and changes nothing.

DROP TABLE app.audit_event;
DROP FUNCTION app.set_audit_retention();
DROP TABLE app.retention_policy;
