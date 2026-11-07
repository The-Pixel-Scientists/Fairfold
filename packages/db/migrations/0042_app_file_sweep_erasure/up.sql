-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0042, up: the file sweep's row delete and file erasure, the two
-- approved definer functions of ADR 0030, each executable by app_worker
-- only and owned by a NOLOGIN role that owns nothing else.
--
-- The sweep locks a row and checks its state as app_worker, under its
-- column grants from 0041, then deletes the object. Only
-- app.delete_swept_file() then removes a row: a released file's, or a
-- refused one's that no record links, 12 months after its scan (ADR 0047's
-- audit floor). A restrictive policy holds its owner to those rows.
--
-- app.erase_file() sets a file's erasure time, so 0041's trigger clears its
-- name, hash and key, only for a running erasure request of this tenant
-- whose party is already erased (ADR 0027's guard, as
-- grants.clear_answer_fields() follows party.erase_party()). The module's
-- erasure contribution chooses the files. It writes no audit event: the
-- erasure's own event covers it.

CREATE FUNCTION app.delete_swept_file(file_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  sweep_tenant CONSTANT uuid := app.current_tenant_id();
  deleted integer;
BEGIN
  IF sweep_tenant IS NULL THEN
    RAISE EXCEPTION 'The file sweep needs a tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  DELETE FROM app.file f
   WHERE f.tenant_id = sweep_tenant AND f.id = delete_swept_file.file_id
     AND (f.released_at IS NOT NULL
          OR (f.scan_state IN ('infected', 'error') AND f.linked_at IS NULL
              AND f.scanned_at < pg_catalog.now() - interval '12 months'));
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted = 1;
END
$function$;

CREATE POLICY sweep_delete ON app.file AS RESTRICTIVE FOR DELETE
  TO owner_app_delete_swept_file
  USING (released_at IS NOT NULL
         OR (scan_state IN ('infected', 'error') AND linked_at IS NULL
             AND scanned_at < now() - interval '12 months'));

GRANT USAGE ON SCHEMA app TO owner_app_delete_swept_file;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_app_delete_swept_file;
GRANT SELECT (tenant_id, id, scan_state, scanned_at, linked_at, released_at), DELETE
   ON app.file TO owner_app_delete_swept_file;

REVOKE ALL ON FUNCTION app.delete_swept_file(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delete_swept_file(uuid) TO app_worker;
GRANT CREATE ON SCHEMA app TO owner_app_delete_swept_file;
ALTER FUNCTION app.delete_swept_file(uuid) OWNER TO owner_app_delete_swept_file;
REVOKE CREATE ON SCHEMA app FROM owner_app_delete_swept_file;

CREATE FUNCTION app.erase_file(file_id uuid, job_request_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erase_tenant CONSTANT uuid := app.current_tenant_id();
  erased integer;
BEGIN
  IF erase_tenant IS NULL THEN
    RAISE EXCEPTION 'Erasure needs a tenant.' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM FROM app.job_request r
    JOIN party.party p ON p.tenant_id = r.tenant_id AND p.id::text = r.filters ->> 'partyId'
   WHERE r.tenant_id = erase_tenant AND r.id = erase_file.job_request_id
     AND r.kind = 'erasure' AND r.permission = 'platform.erasure.request'
     AND r.status = 'running' AND p.status = 'erased';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Erasing a file needs a running erasure request of this tenant whose party is erased.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE app.file f SET erased_at = pg_catalog.now()
   WHERE f.tenant_id = erase_tenant AND f.id = erase_file.file_id AND f.erased_at IS NULL;
  GET DIAGNOSTICS erased = ROW_COUNT;
  RETURN erased = 1;
END
$function$;

GRANT USAGE ON SCHEMA app, party TO owner_app_erase_file;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_app_erase_file;
GRANT SELECT (tenant_id, id, erased_at), UPDATE (erased_at) ON app.file TO owner_app_erase_file;
GRANT SELECT (tenant_id, id, kind, permission, status, filters)
   ON app.job_request TO owner_app_erase_file;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_app_erase_file;

REVOKE ALL ON FUNCTION app.erase_file(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_file(uuid, uuid) TO app_worker;
GRANT CREATE ON SCHEMA app TO owner_app_erase_file;
ALTER FUNCTION app.erase_file(uuid, uuid) OWNER TO owner_app_erase_file;
REVOKE CREATE ON SCHEMA app FROM owner_app_erase_file;
