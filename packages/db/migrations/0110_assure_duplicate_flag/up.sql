-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0110, up: assure duplicate flags (B15-03, ADR 0025, ADR 0031),
-- so dismissDuplicateFlag in modules/assure/src/contracts/duplicates.ts can
-- dismiss one. The route carries only the flag's id, which the server
-- derives from the two parties and the signal, so a flag is recorded when a
-- list first raises it: that id, the parties, the signal and who listed it
-- (created_by), raised at created_at. Its dismissal is on the same row,
-- set once with a reason from the contract's list, by a member, at the
-- database's time. Party ids and codes only: no name, identifier, email or
-- phone, so assure's erasure has nothing to clear here. A flag is advisory
-- and never blocks, links, merges or rejects anyone (rule 9). No app role
-- deletes one. The server writes the audit event with the actor from the
-- session (rules 4 and 6).

CREATE TABLE assure.duplicate_flag (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  party_id uuid NOT NULL,
  other_party_id uuid NOT NULL,
  signal text NOT NULL
    CHECK (signal IN ('shared_identifier', 'similar_name', 'shared_contact_point')),
  dismiss_reason text CHECK (dismiss_reason IN (
    'different_organisation', 'different_person', 'related_but_separate', 'duplicate_allowed')),
  dismissed_by uuid,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT duplicate_flag_raised_once UNIQUE (tenant_id, party_id, other_party_id, signal),
  CONSTRAINT duplicate_flag_two_parties CHECK (party_id <> other_party_id),
  CONSTRAINT duplicate_flag_dismissal
    CHECK (num_nulls(dismiss_reason, dismissed_by, dismissed_at) IN (0, 3)),
  CONSTRAINT duplicate_flag_dismisser CHECK (dismissed_by IS NULL OR dismissed_by = updated_by),
  FOREIGN KEY (tenant_id, party_id) REFERENCES party.party (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, other_party_id) REFERENCES party.party (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, dismissed_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX duplicate_flag_other ON assure.duplicate_flag (tenant_id, other_party_id);
SELECT app.enable_tenant_rls('assure.duplicate_flag');
SELECT app.deny_command('assure.duplicate_flag', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON assure.duplicate_flag
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON assure.duplicate_flag
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_party BEFORE INSERT ON assure.duplicate_flag
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('party_id', 'other_party_id');

-- A flag keeps its parties, signal and author, and is dismissed once;
-- dismissed_at is the database's time.
CREATE FUNCTION assure.check_duplicate_flag()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.dismissed_at := CASE WHEN NEW.dismissed_by IS NOT NULL THEN pg_catalog.now() END;
    RETURN NEW;
  END IF;
  IF (NEW.party_id, NEW.other_party_id, NEW.signal, NEW.created_by)
     IS DISTINCT FROM (OLD.party_id, OLD.other_party_id, OLD.signal, OLD.created_by) THEN
    RAISE EXCEPTION 'A duplicate flag keeps its parties, signal and author.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF OLD.dismissed_by IS NOT NULL
     AND (NEW.dismiss_reason, NEW.dismissed_by, NEW.updated_by)
         IS DISTINCT FROM (OLD.dismiss_reason, OLD.dismissed_by, OLD.updated_by) THEN
    RAISE EXCEPTION 'A duplicate flag is dismissed once.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.dismissed_at := CASE
    WHEN NEW.dismissed_by IS NULL THEN NULL
    WHEN OLD.dismissed_by IS NULL THEN pg_catalog.now()
    ELSE OLD.dismissed_at
  END;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_duplicate_flag BEFORE INSERT OR UPDATE ON assure.duplicate_flag
  FOR EACH ROW EXECUTE FUNCTION assure.check_duplicate_flag();
GRANT SELECT, INSERT (tenant_id, id, party_id, other_party_id, signal, created_by, updated_by),
      UPDATE (dismiss_reason, dismissed_by, updated_by)
   ON assure.duplicate_flag TO app_api;
-- The worker reads flags for assure's subject access contribution (ADR 0027).
GRANT SELECT ON assure.duplicate_flag TO app_worker;
