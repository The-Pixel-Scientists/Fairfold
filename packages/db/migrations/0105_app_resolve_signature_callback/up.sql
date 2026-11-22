-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0105, up: app.resolve_signature_callback(), the approved
-- definer function through which the unauthenticated signature callback
-- route finds a connection's tenant (ADR 0040, "Callbacks"; ADR 0003).
--
-- One indexed lookup by the callback reference's SHA-256. It returns the
-- tenant id and callback key version of an active connection of an active
-- tenant, and no row otherwise, never an error, so the route answers the
-- same whatever the reference. It returns no provider data, request, file,
-- person or status, and sets no tenant (ADR 0019). Its owner reads only the
-- columns ADR 0040 names, through a SELECT policy to it on each table.
-- Handed to its owner as ADR 0023 describes.

CREATE FUNCTION app.resolve_signature_callback(reference_hash bytea)
  RETURNS TABLE (tenant_id uuid, callback_key_version smallint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT c.tenant_id, c.callback_key_version
    FROM app.signature_connection AS c
    JOIN app.tenant AS t ON t.id = c.tenant_id
   WHERE c.callback_reference_hash = resolve_signature_callback.reference_hash
     AND c.status = 'active' AND t.status = 'active';
END;

GRANT USAGE ON SCHEMA app TO owner_app_resolve_signature_callback;
GRANT SELECT (id, status) ON app.tenant TO owner_app_resolve_signature_callback;
GRANT SELECT (tenant_id, id, status, callback_reference_hash, callback_key_version)
   ON app.signature_connection TO owner_app_resolve_signature_callback;
CREATE POLICY resolve_signature_callback_select ON app.tenant FOR SELECT
  TO owner_app_resolve_signature_callback USING (true);
CREATE POLICY resolve_signature_callback_select ON app.signature_connection FOR SELECT
  TO owner_app_resolve_signature_callback USING (true);

REVOKE ALL ON FUNCTION app.resolve_signature_callback(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_signature_callback(bytea) TO app_api;
GRANT CREATE ON SCHEMA app TO owner_app_resolve_signature_callback;
ALTER FUNCTION app.resolve_signature_callback(bytea) OWNER TO owner_app_resolve_signature_callback;
REVOKE CREATE ON SCHEMA app FROM owner_app_resolve_signature_callback;
