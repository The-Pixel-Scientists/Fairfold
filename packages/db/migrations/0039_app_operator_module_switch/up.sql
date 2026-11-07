-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0039, up: the operator switches a tool on as app_worker (S11-69,
-- ADR 0024).
--
-- The operator's create-tenant command, after app.create_tenant() in the same
-- transaction, and its one-off grants backfill both run as app_worker with
-- one tenant set by withTenant(). Each switches a module on and records a
-- platform.module configuration version, with the operator as the author
-- (0026's author kinds) and no membership.
--
-- app_worker may read both tables and add rows, never change or remove them.
-- The tenant policies from app.enable_tenant_rls() already limit it to the
-- tenant set; the policies below also hold its new rows to that tenant, to
-- the operator author and, for a switch, to on. Switching off stays a
-- member's update through app_api. app_api's grants are unchanged, so it
-- still writes only user rows.

GRANT SELECT, INSERT (tenant_id, module, enabled, updated_by_kind)
   ON app.tenant_module TO app_worker;
CREATE POLICY operator_switch_insert ON app.tenant_module AS RESTRICTIVE FOR INSERT
  TO app_worker
  WITH CHECK (tenant_id = app.current_tenant_id()
              AND updated_by_kind = 'operator' AND updated_by IS NULL
              AND enabled);

GRANT SELECT, INSERT (tenant_id, entity_type, entity_id, version, author_kind, diff)
   ON app.config_version TO app_worker;
CREATE POLICY operator_version_insert ON app.config_version AS RESTRICTIVE FOR INSERT
  TO app_worker
  WITH CHECK (tenant_id = app.current_tenant_id()
              AND author_kind = 'operator' AND author_id IS NULL
              AND entity_type = 'platform.module');
