-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0004, down: remove the auth schema, auth.session_context() and
-- the membership's foreign key to auth.user.
--
-- Dropping a table or function removes its rows, policies, triggers and
-- grants, including the function owner's. migrator owns the schema, so it
-- may drop the function its owner holds (ADR 0023). Accounts, sessions and
-- auth events cannot come back, so outside development the rollback for
-- this migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these, this fails and changes nothing.

DROP FUNCTION auth.session_context(bytea);
ALTER TABLE app.membership DROP CONSTRAINT membership_user_id_fkey;
DROP TABLE auth.audit_copy_pending;
DROP TABLE auth.audit_event;
DROP FUNCTION auth.set_audit_retention();
DROP TABLE auth.rate_limit;
DROP TABLE auth.two_factor;
DROP TABLE auth.verification;
DROP TABLE auth.account;
DROP TABLE auth.session;
DROP TABLE auth."user";
DROP SCHEMA auth;
