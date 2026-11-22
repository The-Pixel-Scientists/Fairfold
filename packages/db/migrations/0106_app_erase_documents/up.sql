-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0106, up: app.erase_subject_documents(), the approved erasure
-- of a subject's signature documents (ADR 0027, ADR 0040 "Retention and
-- erasure"), owned by its own owner role (ADR 0023) and callable by
-- app_worker alone.
--
-- Run by the erasure job after party.erase_party, in the tenant set in the
-- transaction, it refuses unless the party is already erased there. No
-- signer name or address is stored, so the files are what it erases: every
-- file sent, signed file and evidence of a request the person signs or was
-- asked to sign, through app.file's erasure time, whose trigger clears the
-- name, hash and storage key. It keeps every id, status, order and time,
-- and the SHA-256 the request records of the file sent; it deletes nothing.
-- Cancelling an open request at the provider is the worker's (S12-85). A
-- repeat call changes nothing further. It writes no audit event: the
-- erasure's own event covers it, as app.erase_subject_notes.

CREATE FUNCTION app.erase_subject_documents(party_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erase_tenant CONSTANT uuid := app.current_tenant_id();
  files integer;
BEGIN
  IF erase_tenant IS NULL THEN
    RAISE EXCEPTION 'Erasure needs a tenant.' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM FROM party.party p
   WHERE p.tenant_id = erase_tenant AND p.id = erase_subject_documents.party_id
     AND p.status = 'erased';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A party''s documents are erased only once the party is erased in this tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE app.file f SET erased_at = pg_catalog.now()
    FROM app.signature_request_file l
    JOIN app.signature_signer s
      ON s.tenant_id = l.tenant_id AND s.signature_request_id = l.signature_request_id
   WHERE f.tenant_id = erase_tenant AND l.tenant_id = f.tenant_id AND l.file_id = f.id
     AND s.person_id = erase_subject_documents.party_id AND f.erased_at IS NULL;
  GET DIAGNOSTICS files = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object('app.file', files);
END
$function$;

GRANT USAGE ON SCHEMA app, party TO owner_app_erase_documents;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_app_erase_documents;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_app_erase_documents;
GRANT SELECT (tenant_id, signature_request_id, person_id)
   ON app.signature_signer TO owner_app_erase_documents;
GRANT SELECT (tenant_id, signature_request_id, file_id)
   ON app.signature_request_file TO owner_app_erase_documents;
GRANT SELECT (tenant_id, id, erased_at), UPDATE (erased_at)
   ON app.file TO owner_app_erase_documents;

REVOKE ALL ON FUNCTION app.erase_subject_documents(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_subject_documents(uuid) TO app_worker;
GRANT CREATE ON SCHEMA app TO owner_app_erase_documents;
ALTER FUNCTION app.erase_subject_documents(uuid) OWNER TO owner_app_erase_documents;
REVOKE CREATE ON SCHEMA app FROM owner_app_erase_documents;
