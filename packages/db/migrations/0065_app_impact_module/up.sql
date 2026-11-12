-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0065, up: let a tenant switch the impact tool, the first of
-- wave 2.
--
-- The check keeps its name and shape and only widens, so every existing row
-- still passes. No row is read, written or rewritten, and no grant, policy
-- or column changes. The list copies switchableModuleIds in
-- packages/domain/src/platform; domain-lists.test.ts reads it back so
-- neither can change alone.

-- A tool with no row stays off (ADR 0024), so admitting its rows switches
-- nothing on by itself.
ALTER TABLE app.tenant_module DROP CONSTRAINT tenant_module_module_check;
ALTER TABLE app.tenant_module ADD CONSTRAINT tenant_module_module_check
  CHECK (module IN ('grants', 'crm', 'assure', 'forms', 'privacy', 'insight', 'impact'));
