-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0033, up: erasing a party in place, clearing an erased
-- applicant's answers, and subject keys (ADR 0027; S11-106).
--
-- Three approved definer functions, each with its own NOLOGIN owner that
-- owns nothing else (ADR 0023), executable by app_worker alone, since
-- erasure runs as a job. Each takes its tenant from the transaction and
-- refuses without one, acts on one party or application per call, uses the
-- database's clock, and never deletes a row. A fourth, party.is_erased(),
-- backs the guards that keep an erased party's data final. Every right and
-- policy here is listed in test/catalogue.

-- The erased status (ADR 0027, "What erasure does to a party"). A merged
-- party's former survivor stays named once it is erased (ADR 0025,
-- "Erasure after a merge").
ALTER TABLE party.party DROP CONSTRAINT party_status_check;
ALTER TABLE party.party DROP CONSTRAINT party_merged_names_survivor;
ALTER TABLE party.party
  ADD COLUMN erased_at timestamptz,
  ADD CONSTRAINT party_status_check
    CHECK (status IN ('active', 'archived', 'merged', 'erased')),
  ADD CONSTRAINT party_erased_at CHECK ((status = 'erased') = (erased_at IS NOT NULL)),
  ADD CONSTRAINT party_merged_names_survivor
    CHECK (status <> 'merged' OR merged_into IS NOT NULL),
  ADD CONSTRAINT party_survivor_kept
    CHECK (merged_into IS NULL OR status IN ('merged', 'erased'));

-- A party becomes erased only once its personal columns hold ADR 0027's
-- erased values, which the column checks accept: a person's email
-- <party id>@erased.invalid and nulls; an organisation's address erased,
-- erased, erased, ZZ with no second line. The database sets erased_at, and
-- an erased party row never changes again, whoever asks; the guards below
-- keep the rest of its data. It runs with the caller's rights.
CREATE FUNCTION party.keep_erased_party()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'erased' THEN
    RAISE EXCEPTION 'An erased party never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.status <> 'erased' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT'
     OR EXISTS (SELECT FROM party.person p
                 WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.id
                   AND (p.given_name, p.family_name, p.phone, p.user_id, p.email)
                       IS DISTINCT FROM
                       (NULL, NULL, NULL, NULL, NEW.id::text || '@erased.invalid'))
     OR EXISTS (SELECT FROM party.organisation o
                 WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.id
                   AND (o.address_line1, o.address_line2, o.address_town, o.address_postcode,
                        o.address_country_code)
                       IS DISTINCT FROM ('erased', NULL, 'erased', 'erased', 'ZZ')) THEN
    RAISE EXCEPTION 'A party is erased only once its personal columns are cleared.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.erased_at := pg_catalog.now();
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_erased_party BEFORE INSERT OR UPDATE ON party.party
  FOR EACH ROW EXECUTE FUNCTION party.keep_erased_party();

-- No app role moves a party into erased or changes an erased one.
CREATE POLICY erased_final ON party.party AS RESTRICTIVE FOR UPDATE
  TO app_api, app_worker, app_queue, app_auth
  USING (status <> 'erased') WITH CHECK (status <> 'erased');

-- Whether a party is erased (ADR 0027, "Locks"). It reads the status under
-- FOR KEY SHARE, held to the caller's commit: a write it lets through either
-- commits before an erasure locks the party, and is erased with the rest,
-- or waits for the erasure and is refused. False for a null id or a party
-- the tenant cannot see, which the write's own policy and foreign key
-- refuse. The lock clause needs an UPDATE right; the owner's is on
-- updated_at, which set_updated_at overwrites, and it updates nothing.
CREATE FUNCTION party.is_erased(tenant_id uuid, party_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erased boolean;
BEGIN
  IF is_erased.party_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT p.status = 'erased' INTO erased
    FROM party.party p
   WHERE p.tenant_id = is_erased.tenant_id AND p.id = is_erased.party_id
     FOR KEY SHARE;
  RETURN COALESCE(erased, false);
END
$function$;

GRANT USAGE ON SCHEMA app, party TO owner_party_is_erased;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_party_is_erased;
GRANT SELECT (tenant_id, id, status), UPDATE (updated_at) ON party.party TO owner_party_is_erased;

REVOKE ALL ON FUNCTION party.is_erased(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION party.is_erased(uuid, uuid) TO app_api, app_worker, owner_party_erase_party;
GRANT CREATE ON SCHEMA party TO owner_party_is_erased;
ALTER FUNCTION party.is_erased(uuid, uuid) OWNER TO owner_party_is_erased;
REVOKE CREATE ON SCHEMA party FROM owner_party_is_erased;
-- The guards bind migrator's writes too. Its own right went to the owner
-- with the function, so the owner grants it (ADR 0023).
SET LOCAL ROLE owner_party_is_erased;
GRANT EXECUTE ON FUNCTION party.is_erased(uuid, uuid) TO migrator;
RESET ROLE;

-- An erased party's data is final too (ADR 0027, "erased is final"): no
-- row naming it in a party column, given as the trigger's arguments, is
-- added or changed, whoever asks. erase_party clears a party's rows before
-- it marks the party erased, so its own writes pass. The tenant is the
-- transaction's, which the row's tenant policy requires, since a later
-- trigger may set the row's own (party.take_organisation_snapshot).
CREATE FUNCTION party.refuse_erased_party()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  write_tenant CONSTANT uuid := app.current_tenant_id();
  new_row CONSTANT jsonb := pg_catalog.to_jsonb(NEW);
  old_row CONSTANT jsonb := CASE WHEN TG_OP = 'UPDATE' THEN pg_catalog.to_jsonb(OLD) END;
  party_column text;
BEGIN
  FOREACH party_column IN ARRAY TG_ARGV LOOP
    IF party.is_erased(write_tenant, (new_row ->> party_column)::uuid)
       OR party.is_erased(write_tenant, (old_row ->> party_column)::uuid) THEN
      RAISE EXCEPTION 'An erased party''s data never changes.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE ON party.person
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('id');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE ON party.organisation
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('id');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE ON party.organisation_identifier
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('organisation_id');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE ON party.organisation_snapshot
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('organisation_id');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE ON party.relationship
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('subject_id', 'object_id');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE ON party.consent
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('person_id');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE ON party.value_history
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('party_id');
-- An application's workflow still runs once its applicant is erased; its
-- answers are guarded by check_application_change below.
CREATE TRIGGER refuse_erased_party
  BEFORE INSERT OR UPDATE OF applicant_person_id, organisation_id ON grants.application
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('applicant_person_id', 'organisation_id');
-- A decision email stays as the record of who was told what, and its sender
-- may still mark it failed, but no new one names an erased recipient.
CREATE TRIGGER refuse_erased_party
  BEFORE INSERT OR UPDATE OF recipient_person_id ON grants.decision_email
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('recipient_person_id');

-- A score's comment is personal: a reviewer's words about the applicant of
-- its assignment's application. Assessment of an erased applicant's
-- application still runs, so scores are still added and changed, and a
-- comment may be cleared, but none is written. The applicant is read with
-- the caller's rights.
CREATE FUNCTION grants.refuse_erased_score_comment()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  applicant uuid;
BEGIN
  IF NEW.comment = ''
     OR (TG_OP = 'UPDATE' AND NEW.comment = OLD.comment
         AND NEW.assignment_id = OLD.assignment_id) THEN
    RETURN NEW;
  END IF;
  SELECT a.applicant_person_id INTO applicant
    FROM grants.assignment s
    JOIN grants.application a ON a.tenant_id = s.tenant_id AND a.id = s.application_id
   WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.assignment_id;
  IF party.is_erased(NEW.tenant_id, applicant) THEN
    RAISE EXCEPTION 'An erased applicant''s score comments never change.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER refuse_erased_score_comment
  BEFORE INSERT OR UPDATE OF assignment_id, comment ON grants.score
  FOR EACH ROW EXECUTE FUNCTION grants.refuse_erased_score_comment();

-- A cleared value history row keeps its field, actor and time (ADR 0025).
ALTER TABLE party.value_history DROP CONSTRAINT value_history_changed;
ALTER TABLE party.value_history ADD CONSTRAINT value_history_changed
  CHECK (old_value IS DISTINCT FROM new_value OR (old_value IS NULL AND new_value IS NULL));

-- Erase one party, named by a running erasure request of this tenant for
-- it or for another party of its merge set (ADR 0025: the engine erases
-- each). The request's member is the event's actor. An erased party gives
-- zero counts and no event. A person whose account is still a member of
-- the tenant is refused: the platform removes the membership first.
-- Consents stay (ADR 0027).
CREATE FUNCTION party.erase_party(party_id uuid, job_request_id uuid)
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

-- The owner's rights: the columns it reads and clears, the request, the
-- membership check, and the audit columns it writes, never occurred_at,
-- retain_until or actor_member_kind. The audit triggers read the retention
-- setting and the actor's roles with its rights. Every table's tenant
-- policies are TO PUBLIC, so they bind the owner too; the restrictive
-- UPDATE denials on snapshots and value history name the app roles only.
GRANT USAGE ON SCHEMA app, party TO owner_party_erase_party;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_party_erase_party;
GRANT SELECT (tenant_id, id, status, merged_into), UPDATE (status)
   ON party.party TO owner_party_erase_party;
GRANT SELECT (tenant_id, id, given_name, family_name, email, phone, user_id),
      UPDATE (given_name, family_name, email, phone, user_id)
   ON party.person TO owner_party_erase_party;
GRANT SELECT (tenant_id, id, address_line1, address_line2, address_town, address_postcode,
              address_country_code),
      UPDATE (address_line1, address_line2, address_town, address_postcode, address_country_code)
   ON party.organisation TO owner_party_erase_party;
GRANT SELECT (tenant_id, organisation_id),
      UPDATE (address_line1, address_line2, address_town, address_postcode, address_country_code)
   ON party.organisation_snapshot TO owner_party_erase_party;
GRANT SELECT (tenant_id, party_id, field_id, old_value, new_value),
      UPDATE (old_value, new_value)
   ON party.value_history TO owner_party_erase_party;
GRANT SELECT (tenant_id, id, kind, permission, status, filters, requested_by, request_id)
   ON app.job_request TO owner_party_erase_party;
GRANT SELECT (tenant_id, id, user_id, status, roles) ON app.membership TO owner_party_erase_party;
GRANT SELECT (tenant_id, policy, days) ON app.retention_policy TO owner_party_erase_party;
GRANT INSERT (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id,
              subject_party_id, changes)
   ON app.audit_event TO owner_party_erase_party;

REVOKE ALL ON FUNCTION party.erase_party(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION party.erase_party(uuid, uuid) TO app_worker;
GRANT CREATE ON SCHEMA party TO owner_party_erase_party;
ALTER FUNCTION party.erase_party(uuid, uuid) OWNER TO owner_party_erase_party;
REVOKE CREATE ON SCHEMA party FROM owner_party_erase_party;

-- Remove the listed answers, by stable field id, from one application whose
-- applicant is erased, so it can only follow party.erase_party (ADR 0027,
-- "Form answers"). Every other answer and column stays. It writes no audit
-- event: the erasure's own event covers it. It returns 1 if it changed the
-- application, else 0.
CREATE FUNCTION grants.clear_answer_fields(application_id uuid, field_ids text[])
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  clear_tenant CONSTANT uuid := app.current_tenant_id();
  cleared integer;
BEGIN
  IF clear_tenant IS NULL THEN
    RAISE EXCEPTION 'Clearing answers needs a tenant.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF pg_catalog.array_ndims(field_ids) IS DISTINCT FROM 1
     OR pg_catalog.cardinality(field_ids) > 500
     OR EXISTS (SELECT FROM pg_catalog.unnest(field_ids) AS f(id)
                 WHERE f.id IS NULL OR f.id !~ '^f_[a-z0-9]{1,32}$') THEN
    RAISE EXCEPTION 'Name between 1 and 500 answer field ids.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM FROM grants.application a
    JOIN party.party p ON p.tenant_id = a.tenant_id AND p.id = a.applicant_person_id
   WHERE a.tenant_id = clear_tenant AND a.id = clear_answer_fields.application_id
     AND p.status = 'erased'
     FOR UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Answers are cleared only from an application of this tenant whose applicant is erased.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE grants.application a
     SET answers = a.answers OPERATOR(pg_catalog.-) clear_answer_fields.field_ids
   WHERE a.tenant_id = clear_tenant AND a.id = clear_answer_fields.application_id
     AND a.answers OPERATOR(pg_catalog.?|) clear_answer_fields.field_ids;
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RETURN cleared;
END
$function$;

-- The answers of a submitted or withdrawn application, or of an erased
-- applicant's, never change, except through grants.clear_answer_fields,
-- whose owner may update no other column. Otherwise as migration 0011.
CREATE OR REPLACE FUNCTION grants.check_application_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF current_user = 'owner_grants_clear_answer_fields' THEN
    RETURN NEW;
  END IF;
  IF NEW.answers IS DISTINCT FROM OLD.answers
     AND party.is_erased(NEW.tenant_id, NEW.applicant_person_id) THEN
    RAISE EXCEPTION 'An erased applicant''s answers never change.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'A withdrawn application never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'A submitted application cannot go back to draft.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'withdrawn' THEN
    RAISE EXCEPTION 'Only a submitted application can be withdrawn.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF OLD.status <> 'draft'
     AND (NEW.answers, NEW.answers_version, NEW.submitted_at, NEW.submitted_late)
         IS DISTINCT FROM
         (OLD.answers, OLD.answers_version, OLD.submitted_at, OLD.submitted_late) THEN
    RAISE EXCEPTION 'The answers and submission of a submitted application never change.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'submitted' THEN
    NEW.submitted_at := pg_catalog.now();
  END IF;
  IF OLD.status = 'submitted' AND NEW.status = 'withdrawn' THEN
    NEW.withdrawn_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;

GRANT USAGE ON SCHEMA app, grants, party TO owner_grants_clear_answer_fields;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_grants_clear_answer_fields;
GRANT SELECT (tenant_id, id, applicant_person_id, answers), UPDATE (answers)
   ON grants.application TO owner_grants_clear_answer_fields;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_grants_clear_answer_fields;

REVOKE ALL ON FUNCTION grants.clear_answer_fields(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grants.clear_answer_fields(uuid, text[]) TO app_worker;
GRANT CREATE ON SCHEMA grants TO owner_grants_clear_answer_fields;
ALTER FUNCTION grants.clear_answer_fields(uuid, text[]) OWNER TO owner_grants_clear_answer_fields;
REVOKE CREATE ON SCHEMA grants FROM owner_grants_clear_answer_fields;

-- One data key per subject party per tenant (ADR 0027, "Audit: per-subject
-- crypto-shredding"): 32 bytes wrapped by the platform key of kek_version
-- with AES-256-GCM (nonce, key and tag), held until destroyed. The audit
-- writer gets or creates a key in its own transaction, so app roles insert
-- and read; only app.destroy_subject_key() changes a row, and no role
-- deletes one. id meets the rule that every tenant table has one.
CREATE TABLE app.subject_key (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  subject_party_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  wrapped_key bytea CHECK (octet_length(wrapped_key) = 60),
  kek_version integer CHECK (kek_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  destroyed_at timestamptz,
  PRIMARY KEY (tenant_id, subject_party_id),
  UNIQUE (tenant_id, id),
  CONSTRAINT subject_key_destroyed CHECK ((wrapped_key IS NULL) <> (destroyed_at IS NULL)),
  CONSTRAINT subject_key_version CHECK (wrapped_key IS NULL OR kek_version IS NOT NULL),
  FOREIGN KEY (tenant_id, subject_party_id) REFERENCES party.party (tenant_id, id)
    ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.subject_key');
SELECT app.deny_command('app.subject_key', 'UPDATE');
SELECT app.deny_command('app.subject_key', 'DELETE');
GRANT SELECT, INSERT (tenant_id, subject_party_id, wrapped_key, kek_version)
   ON app.subject_key TO app_api, app_worker;
-- No key is made for an erased party; destroying one writes no key.
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE ON app.subject_key
  FOR EACH ROW WHEN (NEW.wrapped_key IS NOT NULL)
  EXECUTE FUNCTION party.refuse_erased_party('subject_party_id');

-- Destroy an erased party's key: the row stays, with no key and the time.
-- A party with no key gets a destroyed row, so none can be made for it
-- later. It writes one event when it destroys, and is otherwise a no-op.
CREATE FUNCTION app.destroy_subject_key(subject_party_id uuid)
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

GRANT USAGE ON SCHEMA app, party TO owner_app_destroy_subject_key;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO owner_app_destroy_subject_key;
GRANT SELECT (tenant_id, id, status) ON party.party TO owner_app_destroy_subject_key;
GRANT SELECT (tenant_id, subject_party_id, id, destroyed_at),
      INSERT (tenant_id, subject_party_id, destroyed_at), UPDATE (wrapped_key, destroyed_at)
   ON app.subject_key TO owner_app_destroy_subject_key;
GRANT SELECT (tenant_id, policy, days) ON app.retention_policy TO owner_app_destroy_subject_key;
GRANT INSERT (tenant_id, request_id, actor_kind, action, entity_type, entity_id,
              subject_party_id, changes)
   ON app.audit_event TO owner_app_destroy_subject_key;

REVOKE ALL ON FUNCTION app.destroy_subject_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.destroy_subject_key(uuid) TO app_worker;
GRANT CREATE ON SCHEMA app TO owner_app_destroy_subject_key;
ALTER FUNCTION app.destroy_subject_key(uuid) OWNER TO owner_app_destroy_subject_key;
REVOKE CREATE ON SCHEMA app FROM owner_app_destroy_subject_key;
