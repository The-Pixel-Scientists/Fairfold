-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0002, down: remove the tenancy tables and their two helpers.
--
-- Dropping a table removes its rows, policies, triggers, constraints and
-- grants. Rows cannot come back, so outside development the rollback for
-- this migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these, this fails and changes nothing.

DROP TABLE app.config_version;
DROP TABLE app.tenant_theme;
DROP TABLE app.tenant_module;
DROP TABLE app.membership;
DROP TABLE app.tenant;
DROP FUNCTION app.set_updated_at();
DROP FUNCTION app.deny_command(regclass, text);
