-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0001, down: remove the app schema and its two functions.
--
-- Dropping an object removes every grant on it, so the grants in up.sql need
-- no REVOKE. Nothing here cascades: while a later migration's tables or
-- policies still use the schema or app.current_tenant_id(), this fails and
-- changes nothing.

DROP FUNCTION app.enable_tenant_rls(regclass);
DROP FUNCTION app.current_tenant_id();
DROP SCHEMA app;
