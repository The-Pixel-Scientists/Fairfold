-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0049, up: re-applying the erasure ledger after a restore (ADR
-- 0027 and ADR 0011, "Erasure and restores"; S11-109).
--
-- party.erase_party, app.destroy_subject_key and app.erase_file take one more
-- authority: while the cell is in restore mode, a ledger row of this tenant
-- naming the party (and, for an erasure of a party or file, no job request).
-- Outside restore mode they are unchanged, so a ledger row never authorises an
-- erasure. A re-erasure is written with the system actor and the restore's
-- request id.
--
-- app.reapply_erasure_ledger(), run once per tenant by the restore's one-off
-- worker process (ADR 0011, step 10), repeats each row of the restored
-- table, in the tenant set in the transaction, through those functions and
-- grants.clear_answer_fields: for a party present and not erased, it removes
-- any membership the restored data still gives them, with the standard
-- event, and erases them. It then clears every stored answer of their
-- applications that the pinned form version does not class as public or
-- internal, an unasked key included, as the module's erasure does, and erases
-- every file linked to those applications whatever its question's class. A
-- row whose party is absent is counted and kept. Only the restored table is
-- read: a row found
-- only in an off-site copy erases no one until an operator confirms it
-- through app.restore_erasure_ledger_row (migration 0048). A party erased
-- again and a second call both change nothing further, and each call writes
-- one event with its counts. Rights are listed in test/catalogue.

-- Rights the replaced functions read with. A function replaced in place
-- keeps its grants.
GRANT SELECT (active, request_id) ON app.restore_mode TO owner_party_erase_party;
GRANT SELECT (active) ON app.restore_mode TO owner_app_destroy_subject_key;
GRANT SELECT (tenant_id, subject_party_id, kind) ON app.erasure_ledger
  TO owner_party_erase_party, owner_app_destroy_subject_key;

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
  restore_request uuid;
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
  SELECT m.request_id INTO restore_request FROM app.restore_mode m WHERE m.active;
  IF target.id IS NULL
     OR NOT (EXISTS (SELECT FROM party.party n
                      WHERE n.tenant_id = erase_tenant
                        AND (n.id = target.survivor OR n.merged_into = target.survivor)
                        AND n.id::text = request.named)
             OR (erase_party.job_request_id IS NULL AND restore_request IS NOT NULL
                 AND EXISTS (SELECT FROM app.erasure_ledger l
                              WHERE l.tenant_id = erase_tenant AND l.subject_party_id = target.id
                                AND l.kind = 'party_erased'))) THEN
    RAISE EXCEPTION 'Erasure needs a running erasure request of this tenant for the party, or in restore mode its ledger row.'
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
    VALUES (erase_tenant, COALESCE(request.request_id, restore_request),
            CASE WHEN request.requested_by IS NULL THEN 'system' ELSE 'user' END,
            request.requested_by, 'party.party.erased', 'party.party', target.id, target.id,
            pg_catalog.jsonb_build_object('reason', COALESCE(request.reason, 'ledger_reapplied'),
                                          'counts', counts));
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
  IF NOT FOUND
     AND NOT (EXISTS (SELECT FROM app.restore_mode m WHERE m.active)
              AND EXISTS (SELECT FROM app.erasure_ledger l
                           WHERE l.tenant_id = key_tenant
                             AND l.subject_party_id = destroy_subject_key.subject_party_id
                             AND l.kind = 'subject_key_destroyed')) THEN
    RAISE EXCEPTION 'A subject key is destroyed only once its party is erased in this tenant, or in restore mode by its ledger row.'
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

-- In restore mode a null job request erases only a file linked to an
-- application of an erased party with a ledger row in this tenant.
GRANT USAGE ON SCHEMA grants TO owner_app_erase_file;
GRANT SELECT (active) ON app.restore_mode TO owner_app_erase_file;
GRANT SELECT (tenant_id, subject_party_id, kind) ON app.erasure_ledger TO owner_app_erase_file;
GRANT SELECT (tenant_id, application_id, file_id) ON grants.application_file
  TO owner_app_erase_file;
GRANT SELECT (tenant_id, id, applicant_person_id) ON grants.application TO owner_app_erase_file;

GRANT CREATE ON SCHEMA app TO owner_app_erase_file;
SET LOCAL ROLE owner_app_erase_file;

CREATE OR REPLACE FUNCTION app.erase_file(file_id uuid, job_request_id uuid)
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
  IF NOT FOUND
     AND NOT (erase_file.job_request_id IS NULL
              AND EXISTS (SELECT FROM app.restore_mode m WHERE m.active)
              AND EXISTS (SELECT FROM grants.application_file l
                            JOIN grants.application a
                              ON a.tenant_id = l.tenant_id AND a.id = l.application_id
                            JOIN party.party p
                              ON p.tenant_id = a.tenant_id AND p.id = a.applicant_person_id
                            JOIN app.erasure_ledger e
                              ON e.tenant_id = p.tenant_id AND e.subject_party_id = p.id
                           WHERE l.tenant_id = erase_tenant AND l.file_id = erase_file.file_id
                             AND p.status = 'erased' AND e.kind = 'party_erased')) THEN
    RAISE EXCEPTION 'Erasing a file needs a running erasure request of this tenant whose party is erased, or in restore mode its ledger row.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE app.file f SET erased_at = pg_catalog.now()
   WHERE f.tenant_id = erase_tenant AND f.id = erase_file.file_id AND f.erased_at IS NULL;
  GET DIAGNOSTICS erased = ROW_COUNT;
  RETURN erased = 1;
END
$function$;

RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM owner_app_erase_file;

-- Re-apply the restored ledger of the tenant set in the transaction, only in
-- restore mode. Returns its counts. It raises ER001, for the restore to
-- report, when a removal would leave the tenant with no admin (ADR 0027),
-- which the tenant resolves before re-apply runs again.
CREATE FUNCTION app.reapply_erasure_ledger()
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  reapply_tenant CONSTANT uuid := app.current_tenant_id();
  restore_request uuid;
  entry record;
  party_status text;
  member record;
  application record;
  linked_file uuid;
  field_count integer;
  entries integer := 0;
  re_erased integer := 0;
  keys_destroyed integer := 0;
  absent integer := 0;
  memberships_removed integer := 0;
  answers_cleared integer := 0;
  files_erased integer := 0;
  counts jsonb;
BEGIN
  IF reapply_tenant IS NULL THEN
    RAISE EXCEPTION 'Re-applying the erasure ledger needs a tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT m.request_id INTO restore_request FROM app.restore_mode m WHERE m.active;
  IF restore_request IS NULL THEN
    RAISE EXCEPTION 'The erasure ledger is re-applied only in restore mode.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR entry IN
    SELECT l.subject_party_id, l.kind
      FROM app.erasure_ledger l
     WHERE l.tenant_id = reapply_tenant
     ORDER BY l.kind, l.erased_at, l.id
  LOOP
    entries := entries + 1;
    SELECT p.status INTO party_status
      FROM party.party p
     WHERE p.tenant_id = reapply_tenant AND p.id = entry.subject_party_id;
    IF NOT FOUND THEN
      absent := absent + 1;
      CONTINUE;
    END IF;
    IF entry.kind = 'subject_key_destroyed' THEN
      IF app.destroy_subject_key(entry.subject_party_id) THEN
        keys_destroyed := keys_destroyed + 1;
      END IF;
      CONTINUE;
    END IF;

    IF party_status <> 'erased' THEN
      SELECT m.id, m.status, m.roles INTO member
        FROM party.person p
        JOIN app.membership m ON m.tenant_id = p.tenant_id AND m.user_id = p.user_id
       WHERE p.tenant_id = reapply_tenant AND p.id = entry.subject_party_id
         AND m.status <> 'removed';
      IF member.id IS NOT NULL THEN
        IF member.status = 'active' AND 'tenant_admin' = ANY (member.roles)
           AND NOT EXISTS (SELECT FROM app.membership a
                            WHERE a.tenant_id = reapply_tenant AND a.id <> member.id
                              AND a.status = 'active' AND 'tenant_admin' = ANY (a.roles)) THEN
          RAISE EXCEPTION 'Re-applying the erasure ledger stopped: removing this membership would leave the tenant with no admin.'
            USING ERRCODE = 'ER001';
        END IF;
        UPDATE app.membership m SET status = 'removed'
         WHERE m.tenant_id = reapply_tenant AND m.id = member.id;
        INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, action, entity_type,
                                     entity_id, changes)
        VALUES (reapply_tenant, restore_request, 'system', 'platform.membership.removed',
                'platform.membership', member.id,
                pg_catalog.jsonb_build_object('app.membership.status',
                  pg_catalog.jsonb_build_object('before', member.status, 'after', 'removed')));
        memberships_removed := memberships_removed + 1;
      END IF;
      PERFORM party.erase_party(entry.subject_party_id, NULL);
      re_erased := re_erased + 1;
    END IF;

    FOR application IN
      SELECT a.id,
             ARRAY(SELECT stored.key
                     FROM pg_catalog.jsonb_object_keys(a.answers) AS stored(key)
                    WHERE NOT EXISTS (
                      SELECT FROM pg_catalog.jsonb_array_elements(v.definition -> 'sections') AS s(section),
                                  pg_catalog.jsonb_array_elements(section -> 'fields') AS f(field)
                       WHERE field ->> 'id' = stored.key AND field ->> 'type' <> 'content'
                         AND field ->> 'classification' IN ('public', 'internal'))) AS field_ids
        FROM grants.application a
        JOIN grants.form_version v ON v.tenant_id = a.tenant_id AND v.id = a.form_version_id
       WHERE a.tenant_id = reapply_tenant AND a.applicant_person_id = entry.subject_party_id
    LOOP
      field_count := pg_catalog.cardinality(application.field_ids);
      IF field_count > 0 THEN
        FOR batch IN 0 .. (field_count - 1) / 500 LOOP
          answers_cleared := answers_cleared
            + grants.clear_answer_fields(application.id,
                application.field_ids[batch * 500 + 1 : (batch + 1) * 500]);
        END LOOP;
      END IF;
      FOR linked_file IN
        SELECT l.file_id
          FROM grants.application_file l
         WHERE l.tenant_id = reapply_tenant AND l.application_id = application.id
         ORDER BY l.file_id
      LOOP
        IF app.erase_file(linked_file, NULL) THEN
          files_erased := files_erased + 1;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  counts := pg_catalog.jsonb_build_object(
    'entries', entries, 're_erased', re_erased, 'keys_destroyed', keys_destroyed,
    'absent', absent, 'memberships_removed', memberships_removed,
    'answers_cleared', answers_cleared, 'files_erased', files_erased);
  INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, action, entity_type, entity_id,
                               changes)
  VALUES (reapply_tenant, restore_request, 'system', 'platform.erasure_ledger.reapplied',
          'platform.erasure_ledger', reapply_tenant, counts);
  RETURN counts;
END
$function$;

GRANT USAGE ON SCHEMA app, party, grants TO owner_app_reapply_erasure_ledger;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_app_reapply_erasure_ledger;
GRANT SELECT (active, request_id) ON app.restore_mode TO owner_app_reapply_erasure_ledger;
GRANT SELECT (tenant_id, id, subject_party_id, kind, erased_at) ON app.erasure_ledger
  TO owner_app_reapply_erasure_ledger;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_app_reapply_erasure_ledger;
GRANT SELECT (tenant_id, id, user_id) ON party.person TO owner_app_reapply_erasure_ledger;
GRANT SELECT (tenant_id, id, user_id, status, roles), UPDATE (status)
   ON app.membership TO owner_app_reapply_erasure_ledger;
GRANT SELECT (tenant_id, id, applicant_person_id, form_version_id, answers)
   ON grants.application TO owner_app_reapply_erasure_ledger;
GRANT SELECT (tenant_id, id, definition) ON grants.form_version
   TO owner_app_reapply_erasure_ledger;
GRANT SELECT (tenant_id, application_id, file_id) ON grants.application_file
   TO owner_app_reapply_erasure_ledger;
GRANT SELECT (tenant_id, policy, days) ON app.retention_policy
   TO owner_app_reapply_erasure_ledger;
GRANT INSERT (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
   ON app.audit_event TO owner_app_reapply_erasure_ledger;

-- Each called function's owner grants its EXECUTE (ADR 0023).
SET LOCAL ROLE owner_party_erase_party;
GRANT EXECUTE ON FUNCTION party.erase_party(uuid, uuid) TO owner_app_reapply_erasure_ledger;
RESET ROLE;
SET LOCAL ROLE owner_app_destroy_subject_key;
GRANT EXECUTE ON FUNCTION app.destroy_subject_key(uuid) TO owner_app_reapply_erasure_ledger;
RESET ROLE;
SET LOCAL ROLE owner_grants_clear_answer_fields;
GRANT EXECUTE ON FUNCTION grants.clear_answer_fields(uuid, text[])
  TO owner_app_reapply_erasure_ledger;
RESET ROLE;
SET LOCAL ROLE owner_app_erase_file;
GRANT EXECUTE ON FUNCTION app.erase_file(uuid, uuid) TO owner_app_reapply_erasure_ledger;
RESET ROLE;

REVOKE ALL ON FUNCTION app.reapply_erasure_ledger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reapply_erasure_ledger() TO app_worker;
GRANT CREATE ON SCHEMA app TO owner_app_reapply_erasure_ledger;
ALTER FUNCTION app.reapply_erasure_ledger() OWNER TO owner_app_reapply_erasure_ledger;
REVOKE CREATE ON SCHEMA app FROM owner_app_reapply_erasure_ledger;
