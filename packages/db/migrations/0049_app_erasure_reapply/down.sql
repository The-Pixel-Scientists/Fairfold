-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0049, down: remove the re-apply and put back the erasure
-- functions as migration 0033 wrote them, with no ledger authority.

DROP FUNCTION app.reapply_erasure_ledger();

SET LOCAL ROLE owner_grants_clear_answer_fields;
REVOKE EXECUTE ON FUNCTION grants.clear_answer_fields(uuid, text[])
  FROM owner_app_reapply_erasure_ledger;
RESET ROLE;
SET LOCAL ROLE owner_party_erase_party;
REVOKE EXECUTE ON FUNCTION party.erase_party(uuid, uuid) FROM owner_app_reapply_erasure_ledger;
RESET ROLE;
SET LOCAL ROLE owner_app_destroy_subject_key;
REVOKE EXECUTE ON FUNCTION app.destroy_subject_key(uuid) FROM owner_app_reapply_erasure_ledger;
RESET ROLE;

REVOKE ALL ON app.restore_mode, app.erasure_ledger, party.party, party.person,
              app.membership, grants.application, grants.form_version,
              app.retention_policy, app.audit_event
  FROM owner_app_reapply_erasure_ledger;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_app_reapply_erasure_ledger;
REVOKE USAGE ON SCHEMA app, party, grants FROM owner_app_reapply_erasure_ledger;

GRANT CREATE ON SCHEMA party TO owner_party_erase_party;
SET LOCAL ROLE owner_party_erase_party;

CREATE OR REPLACE FUNCTION party.erase_party(party_id uuid, job_request_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erase_tenant CONSTANT uuid := app.current_tenant_id();
  target record;
  request record;
  people integer := 0;
  organisations integer := 0;
  snapshots integer := 0;
  history integer := 0;
  parties integer := 0;
  counts jsonb;
BEGIN
  IF erase_tenant IS NULL THEN
    RAISE EXCEPTION 'Erasure needs a tenant.' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT p.id, p.status, COALESCE(p.merged_into, p.id) AS survivor INTO target
    FROM party.party p
   WHERE p.tenant_id = erase_tenant AND p.id = erase_party.party_id
     FOR UPDATE;
  SELECT r.requested_by, r.request_id, r.filters ->> 'reason' AS reason,
         r.filters ->> 'partyId' AS named
    INTO request
    FROM app.job_request r
   WHERE r.tenant_id = erase_tenant AND r.id = erase_party.job_request_id
     AND r.kind = 'erasure' AND r.permission = 'platform.erasure.request'
     AND r.status = 'running'
     AND r.filters ->> 'reason' IN ('subject_request', 'tenant_instruction');
  IF target.id IS NULL
     OR NOT EXISTS (SELECT FROM party.party n
                     WHERE n.tenant_id = erase_tenant
                       AND (n.id = target.survivor OR n.merged_into = target.survivor)
                       AND n.id::text = request.named) THEN
    RAISE EXCEPTION 'Erasure needs a running erasure request of this tenant for the party.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF target.status <> 'erased' THEN
    IF EXISTS (SELECT FROM party.person p
                 JOIN app.membership m ON m.tenant_id = p.tenant_id AND m.user_id = p.user_id
                WHERE p.tenant_id = erase_tenant AND p.id = target.id
                  AND m.status <> 'removed') THEN
      RAISE EXCEPTION 'Remove the person''s membership of the tenant before erasing them.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    UPDATE party.person p
       SET given_name = NULL, family_name = NULL, phone = NULL, user_id = NULL,
           email = p.id::text || '@erased.invalid'
     WHERE p.tenant_id = erase_tenant AND p.id = target.id;
    GET DIAGNOSTICS people = ROW_COUNT;
    UPDATE party.organisation o
       SET address_line1 = 'erased', address_line2 = NULL, address_town = 'erased',
           address_postcode = 'erased', address_country_code = 'ZZ'
     WHERE o.tenant_id = erase_tenant AND o.id = target.id;
    GET DIAGNOSTICS organisations = ROW_COUNT;
    UPDATE party.organisation_snapshot s
       SET address_line1 = 'erased', address_line2 = NULL, address_town = 'erased',
           address_postcode = 'erased', address_country_code = 'ZZ'
     WHERE s.tenant_id = erase_tenant AND s.organisation_id = target.id;
    GET DIAGNOSTICS snapshots = ROW_COUNT;
    UPDATE party.value_history h
       SET old_value = NULL, new_value = NULL
     WHERE h.tenant_id = erase_tenant AND h.party_id = target.id
       AND h.field_id IN ('person.given_name', 'person.family_name', 'person.email',
                          'person.phone', 'organisation.address_line1',
                          'organisation.address_line2', 'organisation.address_town',
                          'organisation.address_postcode', 'organisation.address_country_code')
       AND (h.old_value IS NOT NULL OR h.new_value IS NOT NULL);
    GET DIAGNOSTICS history = ROW_COUNT;
    UPDATE party.party p SET status = 'erased'
     WHERE p.tenant_id = erase_tenant AND p.id = target.id;
    GET DIAGNOSTICS parties = ROW_COUNT;
  END IF;

  counts := pg_catalog.jsonb_build_object(
    'party.party', parties, 'party.person', people, 'party.organisation', organisations,
    'party.organisation_snapshot', snapshots, 'party.value_history', history);
  IF parties > 0 THEN
    INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, actor_id, action,
                                 entity_type, entity_id, subject_party_id, changes)
    VALUES (erase_tenant, request.request_id, 'user', request.requested_by, 'party.party.erased',
            'party.party', target.id, target.id,
            pg_catalog.jsonb_build_object('reason', request.reason, 'counts', counts));
  END IF;
  RETURN counts;
END
$function$;

RESET ROLE;
REVOKE CREATE ON SCHEMA party FROM owner_party_erase_party;

GRANT CREATE ON SCHEMA app TO owner_app_destroy_subject_key;
SET LOCAL ROLE owner_app_destroy_subject_key;

CREATE OR REPLACE FUNCTION app.destroy_subject_key(subject_party_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  key_tenant CONSTANT uuid := app.current_tenant_id();
  key_id uuid;
BEGIN
  IF key_tenant IS NULL THEN
    RAISE EXCEPTION 'Destroying a subject key needs a tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM FROM party.party p
   WHERE p.tenant_id = key_tenant AND p.id = destroy_subject_key.subject_party_id
     AND p.status = 'erased';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A subject key is destroyed only once its party is erased in this tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  INSERT INTO app.subject_key AS k (tenant_id, subject_party_id, destroyed_at)
  VALUES (key_tenant, destroy_subject_key.subject_party_id, pg_catalog.now())
  ON CONFLICT ON CONSTRAINT subject_key_pkey DO UPDATE
     SET wrapped_key = NULL, destroyed_at = pg_catalog.now()
   WHERE k.destroyed_at IS NULL
  RETURNING k.id INTO key_id;
  IF key_id IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, action, entity_type, entity_id,
                               subject_party_id, changes)
  VALUES (key_tenant, pg_catalog.gen_random_uuid(), 'system', 'platform.subject_key.destroyed',
          'platform.subject_key', key_id, destroy_subject_key.subject_party_id, '{}');
  RETURN true;
END
$function$;

RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM owner_app_destroy_subject_key;

REVOKE ALL ON app.restore_mode FROM owner_party_erase_party, owner_app_destroy_subject_key;
REVOKE SELECT (tenant_id, subject_party_id, kind) ON app.erasure_ledger
  FROM owner_party_erase_party, owner_app_destroy_subject_key;
