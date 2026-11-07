-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0021, up: let memberships and invitations hold the three new
-- console roles, and let a tenant switch the wave 1 tools (S11-21-roles-db).
--
-- Each check keeps its name and shape and only widens, so every existing
-- row still passes. No row is read, written or rewritten, and no grant,
-- policy or column changes. The lists copy roles and switchableModuleIds in
-- packages/domain/src/platform; domain-lists.test.ts and invitation.test.ts
-- read them back so neither can change alone.

ALTER TABLE app.membership DROP CONSTRAINT membership_roles_check;
ALTER TABLE app.membership ADD CONSTRAINT membership_roles_check CHECK (
  array_ndims(roles) = 1 AND cardinality(roles) > 0
  AND roles <@ ARRAY['tenant_admin', 'programme_manager', 'reviewer', 'due_diligence_officer',
                     'data_protection_lead', 'analyst', 'applicant']);

-- Invitations are for console roles only; applicant stays out.
ALTER TABLE app.invitation DROP CONSTRAINT invitation_roles_check;
ALTER TABLE app.invitation ADD CONSTRAINT invitation_roles_check CHECK (
  array_ndims(roles) = 1 AND cardinality(roles) > 0
  AND roles <@ ARRAY['tenant_admin', 'programme_manager', 'reviewer', 'due_diligence_officer',
                     'data_protection_lead', 'analyst']);

-- A wave 1 tool with no row stays off (ADR 0024), so admitting its rows
-- switches nothing on by itself.
ALTER TABLE app.tenant_module DROP CONSTRAINT tenant_module_module_check;
ALTER TABLE app.tenant_module ADD CONSTRAINT tenant_module_module_check
  CHECK (module IN ('grants', 'crm', 'assure', 'forms', 'privacy', 'insight'));
