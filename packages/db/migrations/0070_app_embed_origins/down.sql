-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0070, down: remove app.embed_origins(), its owner's rights and
-- policies, and the embed origin table with its trigger. Origins cannot come
-- back, so outside development the rollback for this migration is a restore
-- from backup. The owner role stays: the roles script, not a migration,
-- creates and removes roles.

DROP FUNCTION app.embed_origins(text);
DROP POLICY embed_origins_select ON app.tenant_module;
DROP POLICY embed_origins_select ON app.tenant;
REVOKE SELECT (tenant_id, module, enabled) ON app.tenant_module FROM owner_app_embed_origins;
REVOKE SELECT (id, slug, status) ON app.tenant FROM owner_app_embed_origins;
REVOKE USAGE ON SCHEMA app FROM owner_app_embed_origins;

DROP TABLE app.embed_origin;
DROP FUNCTION app.limit_embed_origins();
