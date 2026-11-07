-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0033, down: drop the erasure functions, their owners' rights,
-- app.subject_key and the erased status, restoring 0011's application
-- check and 0020's party and value history checks.
--
-- Erased data cannot be restored, so this refuses, before it changes
-- anything, while any party is erased: the narrower status check cannot
-- hold one. Row-level security hides every tenant's rows from migrator, but
-- validating a check reads every row whatever the policies. To roll back
-- past an erasure, restore the backup taken before the rollback (ADR 0003),
-- then re-apply the erasure (ADR 0027). Dropping app.subject_key loses
-- every key, and with them the personal values sealed under them. The
-- owner roles stay: the roles script creates them, never a migration. The
-- functions go first; migrator owns the schemas, so it may drop them
-- (ADR 0023).
DO $refuse$
BEGIN
  ALTER TABLE party.party DROP CONSTRAINT party_status_check;
  ALTER TABLE party.party
    ADD CONSTRAINT party_status_check CHECK (status IN ('active', 'archived', 'merged'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0033 cannot be rolled back while a party is erased: erased data cannot be restored.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

DROP FUNCTION app.destroy_subject_key(uuid);
DROP FUNCTION grants.clear_answer_fields(uuid, text[]);
DROP FUNCTION party.erase_party(uuid, uuid);

REVOKE INSERT (tenant_id, request_id, actor_kind, action, entity_type, entity_id,
               subject_party_id, changes)
    ON app.audit_event FROM owner_app_destroy_subject_key;
REVOKE SELECT (tenant_id, policy, days) ON app.retention_policy FROM owner_app_destroy_subject_key;
REVOKE SELECT (tenant_id, id, status) ON party.party FROM owner_app_destroy_subject_key;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_app_destroy_subject_key;
REVOKE USAGE ON SCHEMA app, party FROM owner_app_destroy_subject_key;
-- Dropping the table removes every right on it.
DROP TABLE app.subject_key;

REVOKE SELECT (tenant_id, id, status) ON party.party FROM owner_grants_clear_answer_fields;
REVOKE SELECT (tenant_id, id, applicant_person_id, answers), UPDATE (answers)
    ON grants.application FROM owner_grants_clear_answer_fields;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_grants_clear_answer_fields;
REVOKE USAGE ON SCHEMA app, grants, party FROM owner_grants_clear_answer_fields;

CREATE OR REPLACE FUNCTION grants.check_application_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
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

-- The guards; app.subject_key's went with the table.
DROP TRIGGER refuse_erased_score_comment ON grants.score;
DROP FUNCTION grants.refuse_erased_score_comment();
DROP TRIGGER refuse_erased_party ON grants.decision_email;
DROP TRIGGER refuse_erased_party ON grants.application;
DROP TRIGGER refuse_erased_party ON party.value_history;
DROP TRIGGER refuse_erased_party ON party.consent;
DROP TRIGGER refuse_erased_party ON party.relationship;
DROP TRIGGER refuse_erased_party ON party.organisation_snapshot;
DROP TRIGGER refuse_erased_party ON party.organisation_identifier;
DROP TRIGGER refuse_erased_party ON party.organisation;
DROP TRIGGER refuse_erased_party ON party.person;
DROP FUNCTION party.refuse_erased_party();
DROP FUNCTION party.is_erased(uuid, uuid);
REVOKE SELECT (tenant_id, id, status), UPDATE (updated_at) ON party.party FROM owner_party_is_erased;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_party_is_erased;
REVOKE USAGE ON SCHEMA app, party FROM owner_party_is_erased;

REVOKE INSERT (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id,
               subject_party_id, changes)
    ON app.audit_event FROM owner_party_erase_party;
REVOKE SELECT (tenant_id, policy, days) ON app.retention_policy FROM owner_party_erase_party;
REVOKE SELECT (tenant_id, id, user_id, status, roles) ON app.membership FROM owner_party_erase_party;
REVOKE SELECT (tenant_id, id, kind, permission, status, filters, requested_by, request_id)
    ON app.job_request FROM owner_party_erase_party;
REVOKE SELECT (tenant_id, party_id, field_id, old_value, new_value),
       UPDATE (old_value, new_value)
    ON party.value_history FROM owner_party_erase_party;
REVOKE SELECT (tenant_id, organisation_id),
       UPDATE (address_line1, address_line2, address_town, address_postcode, address_country_code)
    ON party.organisation_snapshot FROM owner_party_erase_party;
REVOKE SELECT (tenant_id, id, address_line1, address_line2, address_town, address_postcode,
               address_country_code),
       UPDATE (address_line1, address_line2, address_town, address_postcode, address_country_code)
    ON party.organisation FROM owner_party_erase_party;
REVOKE SELECT (tenant_id, id, given_name, family_name, email, phone, user_id),
       UPDATE (given_name, family_name, email, phone, user_id)
    ON party.person FROM owner_party_erase_party;
REVOKE SELECT (tenant_id, id, status, merged_into), UPDATE (status)
    ON party.party FROM owner_party_erase_party;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_party_erase_party;
REVOKE USAGE ON SCHEMA app, party FROM owner_party_erase_party;

-- Erasure clears the values of erased parties only, so none is cleared now.
ALTER TABLE party.value_history DROP CONSTRAINT value_history_changed;
ALTER TABLE party.value_history ADD CONSTRAINT value_history_changed
  CHECK (old_value IS DISTINCT FROM new_value);

DROP POLICY erased_final ON party.party;
DROP TRIGGER keep_erased_party ON party.party;
DROP FUNCTION party.keep_erased_party();
ALTER TABLE party.party
  DROP CONSTRAINT party_survivor_kept,
  DROP CONSTRAINT party_merged_names_survivor,
  DROP CONSTRAINT party_erased_at,
  DROP COLUMN erased_at,
  ADD CONSTRAINT party_merged_names_survivor
    CHECK ((status = 'merged') = (merged_into IS NOT NULL));
