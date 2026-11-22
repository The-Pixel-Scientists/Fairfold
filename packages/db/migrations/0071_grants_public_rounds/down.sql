-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0071, down: remove grants.public_open_rounds() and every right
-- and policy its owner was given. No row changes. The owner role stays: the
-- roles script, not a migration, creates and removes roles.

DROP FUNCTION grants.public_open_rounds(text);
DROP POLICY public_open_rounds_select ON grants.form_version;
DROP POLICY public_open_rounds_select ON grants.round;
DROP POLICY public_open_rounds_select ON grants.programme;
DROP POLICY public_open_rounds_select ON app.tenant_module;
DROP POLICY public_open_rounds_select ON app.tenant;
REVOKE SELECT (tenant_id, round_id, version, status, definition) ON grants.form_version
  FROM owner_grants_public_open_rounds;
REVOKE SELECT (tenant_id, id, programme_id, title, opens_at, closes_at, timezone, award_min_minor,
               award_max_minor, currency)
  ON grants.round FROM owner_grants_public_open_rounds;
REVOKE SELECT (tenant_id, id, title, summary, status) ON grants.programme
  FROM owner_grants_public_open_rounds;
REVOKE SELECT (tenant_id, module, enabled) ON app.tenant_module
  FROM owner_grants_public_open_rounds;
REVOKE SELECT (id, slug, status) ON app.tenant FROM owner_grants_public_open_rounds;
REVOKE USAGE ON SCHEMA app, grants FROM owner_grants_public_open_rounds;
