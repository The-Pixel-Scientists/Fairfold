-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0039, down: app_worker no longer reads or adds module switches
-- or configuration versions. Rows it added stay; 0026's down refuses while
-- any has the operator as its author.

DROP POLICY operator_version_insert ON app.config_version;
REVOKE SELECT, INSERT (tenant_id, entity_type, entity_id, version, author_kind, diff)
    ON app.config_version FROM app_worker;

DROP POLICY operator_switch_insert ON app.tenant_module;
REVOKE SELECT, INSERT (tenant_id, module, enabled, updated_by_kind)
    ON app.tenant_module FROM app_worker;
