-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0040, down: app_worker switches modules on again as in 0039,
-- and app_operator holds nothing. The role itself stays: the roles script,
-- not a migration, creates and removes roles. Rows it added stay.

DROP POLICY operator_audit_insert ON app.audit_event;
REVOKE SELECT ON app.retention_policy FROM app_operator;
REVOKE INSERT (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id,
               changes, subject_party_id)
    ON app.audit_event FROM app_operator;

ALTER POLICY operator_version_insert ON app.config_version TO app_worker;
REVOKE SELECT, INSERT (tenant_id, entity_type, entity_id, version, author_kind, diff)
    ON app.config_version FROM app_operator;
GRANT SELECT, INSERT (tenant_id, entity_type, entity_id, version, author_kind, diff)
   ON app.config_version TO app_worker;

ALTER POLICY operator_switch_insert ON app.tenant_module TO app_worker;
REVOKE SELECT, INSERT (tenant_id, module, enabled, updated_by_kind)
    ON app.tenant_module FROM app_operator;
GRANT SELECT, INSERT (tenant_id, module, enabled, updated_by_kind)
   ON app.tenant_module TO app_worker;

REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM app_operator;
REVOKE USAGE ON SCHEMA app FROM app_operator;
