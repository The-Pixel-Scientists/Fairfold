-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0092, up: privacy.erase_subject, the approved erasure of a
-- person's privacy data (ADR 0027), owned by its own owner role (ADR 0023)
-- and callable by app_worker alone.

-- The approved erasure of a person's privacy data (ADR 0027), run by the
-- erasure job after party.erase_party, in the tenant set in the
-- transaction. It refuses unless the party is already erased there. The
-- law requires the tenant to keep a record of the request, so it clears
-- only what the person or staff wrote about them: each request's summary,
-- and each of its tasks' titles, which become 'erased'. The kind, dates,
-- clock events and outcome stay, and nothing is deleted. A breach names
-- no person, so none is touched. A repeat call changes nothing further. It
-- writes no audit event: the erasure's own event covers it.
CREATE FUNCTION privacy.erase_subject(party_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erase_tenant CONSTANT uuid := app.current_tenant_id();
  requests integer;
  tasks integer;
BEGIN
  IF erase_tenant IS NULL THEN
    RAISE EXCEPTION 'Erasure needs a tenant.' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM FROM party.party p
   WHERE p.tenant_id = erase_tenant AND p.id = erase_subject.party_id AND p.status = 'erased';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A party''s privacy data is erased only once the party is erased in this tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE privacy.rights_request r SET summary = NULL
   WHERE r.tenant_id = erase_tenant AND r.subject_person_id = erase_subject.party_id
     AND r.summary IS NOT NULL;
  GET DIAGNOSTICS requests = ROW_COUNT;

  UPDATE privacy.request_task t SET title = 'erased'
    FROM privacy.rights_request r
   WHERE t.tenant_id = erase_tenant AND r.tenant_id = t.tenant_id AND r.id = t.request_id
     AND r.subject_person_id = erase_subject.party_id AND t.title <> 'erased';
  GET DIAGNOSTICS tasks = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'privacy.rights_request', requests, 'privacy.request_task', tasks);
END
$function$;

GRANT USAGE ON SCHEMA app, party, privacy TO owner_privacy_erase_subject;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_privacy_erase_subject;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_privacy_erase_subject;
GRANT SELECT (tenant_id, id, subject_person_id, summary), UPDATE (summary)
   ON privacy.rights_request TO owner_privacy_erase_subject;
GRANT SELECT (tenant_id, request_id, title), UPDATE (title)
   ON privacy.request_task TO owner_privacy_erase_subject;

REVOKE ALL ON FUNCTION privacy.erase_subject(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.erase_subject(uuid) TO app_worker;
GRANT CREATE ON SCHEMA privacy TO owner_privacy_erase_subject;
ALTER FUNCTION privacy.erase_subject(uuid) OWNER TO owner_privacy_erase_subject;
REVOKE CREATE ON SCHEMA privacy FROM owner_privacy_erase_subject;
