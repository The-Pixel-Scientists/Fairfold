-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0020, up: the party schema for crm v1 (ADR 0025): staff verify
-- an organisation's identifiers, a party can be marked merged into another,
-- and every change to a party field can be kept in party.value_history.
--
-- party.relationship is unchanged: the contracts still list contact_for
-- alone, and an unmerge reopens the links its merge ended (ADR 0025), so an
-- ended link is not made final here. Nothing here verifies, merges or
-- writes history on its own (rule 9); the party server does each as a named
-- staff action, and the database refuses bad states.

-- Staff verify an identifier by naming themselves in verified_by, taken
-- from the session. The verifier must be an active member of staff in the
-- tenant, and the time always comes from the database: app_api cannot write
-- verified_at, and whatever any other role supplies is overwritten. Clearing
-- verified_by clears the time. party.unverify_changed_identifier() still
-- clears both when the identifier itself changes.
CREATE FUNCTION party.set_verified_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.verified_by IS NULL THEN
    NEW.verified_at := NULL;
  ELSIF NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
    PERFORM 1 FROM app.membership m
     WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.verified_by
       AND m.status = 'active' AND NOT ('applicant' = ANY (m.roles));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only an active member of staff verifies an identifier.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.verified_at := pg_catalog.now();
  ELSE
    NEW.verified_at := OLD.verified_at;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_verified_at BEFORE UPDATE ON party.organisation_identifier
  FOR EACH ROW EXECUTE FUNCTION party.set_verified_at();
GRANT UPDATE (verified_by) ON party.organisation_identifier TO app_api;

-- Merge state (ADR 0025). The loser keeps its row, marked merged, and names
-- its survivor: a party of the same kind in the same tenant, never itself.
-- A merge is reversible (an unmerge), which sets the status back and clears
-- merged_into together. Erasure (S11-106) adds the erased status.
ALTER TABLE party.party DROP CONSTRAINT party_status_check;
ALTER TABLE party.party
  ADD CONSTRAINT party_status_check CHECK (status IN ('active', 'archived', 'merged')),
  ADD COLUMN merged_into uuid,
  ADD CONSTRAINT party_merged_into
    FOREIGN KEY (tenant_id, merged_into, kind) REFERENCES party.party (tenant_id, id, kind)
    ON DELETE RESTRICT,
  ADD CONSTRAINT party_merged_names_survivor
    CHECK ((status = 'merged') = (merged_into IS NOT NULL)),
  ADD CONSTRAINT party_merged_into_other CHECK (merged_into <> id);
CREATE INDEX party_survivor ON party.party (tenant_id, merged_into)
  WHERE merged_into IS NOT NULL;

-- No chains (ADR 0025): a party merges only into an active party, and not
-- while others are merged into it; the executor moves those first. The
-- survivor is locked FOR SHARE, so a concurrent merge of the survivor waits
-- and then sees this one.
CREATE FUNCTION party.refuse_merge_chain()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.merged_into IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.merged_into IS DISTINCT FROM OLD.merged_into) THEN
    PERFORM 1 FROM party.party p
     WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.merged_into AND p.status = 'active'
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A party merges only into an active party.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    IF EXISTS (SELECT 1 FROM party.party p
                WHERE p.tenant_id = NEW.tenant_id AND p.merged_into = NEW.id) THEN
      RAISE EXCEPTION 'A party that others are merged into cannot be merged until they are moved.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER refuse_merge_chain BEFORE INSERT OR UPDATE ON party.party
  FOR EACH ROW EXECUTE FUNCTION party.refuse_merge_chain();
GRANT UPDATE (merged_into) ON party.party TO app_api;

-- One change to a party field (ADR 0025), written by the party server in
-- the same transaction as the change, with the acting membership from the
-- session, or none for a change the system made. Field ids are the
-- contracts' valueHistoryFields, each named after its party's kind. Values
-- are personal whatever the field, and never reach an audit event.
-- Append-only for every app role: clearing an erased party's values belongs
-- to the approved function party.erase_party (ADR 0027, S11-106).
CREATE TABLE party.value_history (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL,
  party_kind text NOT NULL,
  field_id text NOT NULL CHECK (field_id IN (
    'organisation.name', 'organisation.legal_form', 'organisation.address_line1',
    'organisation.address_line2', 'organisation.address_town', 'organisation.address_postcode',
    'organisation.address_country_code', 'organisation.website', 'organisation.identifier',
    'person.given_name', 'person.family_name', 'person.email', 'person.phone')),
  old_value text CHECK (octet_length(old_value) <= 65536),
  new_value text CHECK (octet_length(new_value) <= 65536),
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  CONSTRAINT value_history_field_kind CHECK (split_part(field_id, '.', 1) = party_kind),
  CONSTRAINT value_history_changed CHECK (old_value IS DISTINCT FROM new_value),
  FOREIGN KEY (tenant_id, party_id, party_kind) REFERENCES party.party (tenant_id, id, kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, changed_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX value_history_newest ON party.value_history (tenant_id, party_id, changed_at DESC);
SELECT app.enable_tenant_rls('party.value_history');
SELECT app.deny_command('party.value_history', 'UPDATE');
SELECT app.deny_command('party.value_history', 'DELETE');

-- The time is the database's clock, whatever the caller supplied, so two
-- changes in one transaction keep their order.
CREATE FUNCTION party.set_changed_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.changed_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_changed_at BEFORE INSERT ON party.value_history
  FOR EACH ROW EXECUTE FUNCTION party.set_changed_at();

GRANT SELECT,
      INSERT (tenant_id, party_id, party_kind, field_id, old_value, new_value, changed_by)
   ON party.value_history TO app_api;
