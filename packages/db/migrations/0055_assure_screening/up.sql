-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0055, up: sanctions screening runs, possible matches and the
-- named decisions on them (S12-14, ADR 0031). app_api starts on-demand
-- runs, gives an officer match its linked person and records decisions;
-- the screening job starts runs on submission and list updates, moves them
-- on and raises matches (S12-26). A similarity is advisory: no column,
-- default or trigger turns it into an outcome, and app_worker cannot write
-- a decision (rule 9).

-- A screening of one party against the sanctions list. The worker moves a
-- run on from queued exactly once, recording the list version it used and
-- the threshold it applied, or an error code, never text from an exception.
CREATE TABLE assure.screening_run (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('on_demand', 'submission', 'list_update')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'completed', 'stale_list', 'no_list', 'failed')),
  list_id uuid REFERENCES assure.reference_list (id) ON DELETE RESTRICT,
  list_last_checked_at timestamptz,
  threshold numeric(3, 2) CHECK (threshold > 0 AND threshold <= 0.5),
  names_screened integer NOT NULL DEFAULT 0 CHECK (names_screened >= 0),
  matches_raised integer NOT NULL DEFAULT 0 CHECK (matches_raised >= 0),
  error_code text CHECK (error_code ~ '^[a-z_]{1,64}$'),
  requested_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, party_id),
  CONSTRAINT screening_run_requested CHECK ((trigger = 'on_demand') = (requested_by IS NOT NULL)),
  CONSTRAINT screening_run_list CHECK (
    (status IN ('completed', 'stale_list')) = (list_id IS NOT NULL)
    AND num_nulls(list_id, list_last_checked_at, threshold) IN (0, 3)),
  CONSTRAINT screening_run_error CHECK ((status = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT screening_run_completed CHECK ((status <> 'queued') = (completed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, party_id) REFERENCES party.party (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, requested_by)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX screening_run_party ON assure.screening_run (tenant_id, party_id, created_at DESC);
SELECT app.enable_tenant_rls('assure.screening_run');
SELECT app.deny_command('assure.screening_run', 'DELETE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.screening_run
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('created_at', 'updated_at');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON assure.screening_run
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF party_id ON assure.screening_run
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('party_id');

-- Only a queued run changes, once, to a final status; its party, trigger
-- and requester never change, nor the list version once it has one.
CREATE FUNCTION assure.check_screening_run()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF (NEW.tenant_id, NEW.id, NEW.party_id, NEW.trigger, NEW.requested_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.party_id, OLD.trigger, OLD.requested_by, OLD.created_at) THEN
    RAISE EXCEPTION 'A screening run''s party, trigger and requester never change.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'queued' THEN
      RAISE EXCEPTION 'A screening run changes status once, from queued.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    NEW.completed_at := pg_catalog.now();
  ELSIF (NEW.list_id, NEW.list_last_checked_at, NEW.threshold, NEW.names_screened,
         NEW.matches_raised, NEW.error_code, NEW.completed_at)
        IS DISTINCT FROM
        (OLD.list_id, OLD.list_last_checked_at, OLD.threshold, OLD.names_screened,
         OLD.matches_raised, OLD.error_code, OLD.completed_at) THEN
    RAISE EXCEPTION 'A screening run records its list, counts and error with its status.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_screening_run BEFORE UPDATE ON assure.screening_run
  FOR EACH ROW EXECUTE FUNCTION assure.check_screening_run();

-- A possible match, raised by the worker for a person to review, with the
-- evidence they need copied from the list entry, so superseded entries can
-- go. party_id is the party screened; subject_party_id is whose name
-- matched: the party itself, or the person an officer row is linked to,
-- copied when the officer is linked, and null until then. The officer row
-- may go first (ON DELETE SET NULL); the match stays.
CREATE TABLE assure.screening_match (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  party_id uuid NOT NULL,
  name_source text NOT NULL CHECK (name_source IN ('party', 'registered_name', 'officer')),
  officer_id uuid,
  subject_party_id uuid,
  screened_name text NOT NULL
    CHECK (char_length(screened_name) BETWEEN 1 AND 300 AND screened_name !~ '[[:cntrl:]]'),
  list_id uuid NOT NULL REFERENCES assure.reference_list (id) ON DELETE RESTRICT,
  designation_id text NOT NULL CHECK (designation_id ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{0,39}$'),
  entry_kind text NOT NULL CHECK (entry_kind IN ('individual', 'entity', 'ship')),
  entry_name text NOT NULL
    CHECK (char_length(entry_name) BETWEEN 1 AND 300 AND entry_name !~ '[[:cntrl:]]'),
  regime text NOT NULL CHECK (char_length(regime) BETWEEN 1 AND 200 AND regime !~ '[[:cntrl:]]'),
  designated_on date,
  dates_of_birth text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(dates_of_birth) <= 20 AND array_position(dates_of_birth, NULL) IS NULL
    AND array_to_string(dates_of_birth, ',') ~ '^([0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?(,|$))*$'),
  nationalities text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(nationalities) <= 20 AND array_position(nationalities, NULL) IS NULL
    AND char_length(array_to_string(nationalities, '')) <= 2000
    AND array_to_string(nationalities, '') !~ '[[:cntrl:]]'),
  country text CHECK (char_length(country) BETWEEN 1 AND 100 AND country !~ '[[:cntrl:]]'),
  similarity numeric(4, 3) NOT NULL CHECK (similarity BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- A party's own names are about it or its contacts, and a registered name
  -- about the organisation screened.
  CONSTRAINT screening_match_source CHECK (CASE name_source
    WHEN 'officer' THEN true
    WHEN 'registered_name' THEN officer_id IS NULL AND subject_party_id IS NOT DISTINCT FROM party_id
    ELSE officer_id IS NULL AND subject_party_id IS NOT NULL
  END),
  FOREIGN KEY (tenant_id, run_id, party_id)
    REFERENCES assure.screening_run (tenant_id, id, party_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, officer_id)
    REFERENCES assure.lookup_officer (tenant_id, id) ON DELETE SET NULL (officer_id),
  FOREIGN KEY (tenant_id, subject_party_id)
    REFERENCES party.party (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX screening_match_run ON assure.screening_match (tenant_id, run_id);
CREATE INDEX screening_match_party ON assure.screening_match (tenant_id, party_id, created_at);
CREATE INDEX screening_match_subject ON assure.screening_match (tenant_id, subject_party_id);
CREATE INDEX screening_match_officer ON assure.screening_match (tenant_id, officer_id);
SELECT app.enable_tenant_rls('assure.screening_match');
SELECT app.deny_command('assure.screening_match', 'DELETE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.screening_match
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('created_at');
CREATE TRIGGER refuse_erased_party
  BEFORE INSERT OR UPDATE OF party_id, subject_party_id ON assure.screening_match
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('party_id', 'subject_party_id');
CREATE TRIGGER keep_erased
  BEFORE UPDATE OF screened_name, entry_name, dates_of_birth, nationalities
  ON assure.screening_match
  FOR EACH ROW
  EXECUTE FUNCTION assure.keep_erased('subject_party_id', '{"screened_name": "erased"}');

-- The one change to a match: an officer match takes the person its officer
-- row was linked to, once. Officers are linked first, and new matches from
-- a linked officer carry the person from the start.
CREATE FUNCTION assure.check_match_subject()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.name_source = 'officer' AND NEW.subject_party_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.subject_party_id IS NULL) THEN
    PERFORM FROM assure.lookup_officer o
     WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.officer_id
       AND o.person_id = NEW.subject_party_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An officer match is about the person its officer row is linked to.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.subject_party_id IS DISTINCT FROM OLD.subject_party_id THEN
    RAISE EXCEPTION 'A match''s subject is set once, from its linked officer.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_match_subject BEFORE INSERT OR UPDATE ON assure.screening_match
  FOR EACH ROW EXECUTE FUNCTION assure.check_match_subject();

-- A named member's decision on a match (rule 9, UK GDPR Article 22). Append-
-- only for every app role; the newest is the match's state. Codes only, no
-- free text. A match on an officer not linked to a person can only be
-- decided not_a_match, so kept evidence always has a subject.
CREATE TABLE assure.match_decision (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('not_a_match', 'needs_information', 'confirmed')),
  reason_code text NOT NULL,
  decided_by uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT match_decision_reason CHECK (CASE outcome
    WHEN 'not_a_match' THEN reason_code IN ('different_name', 'different_date_of_birth',
      'different_nationality', 'different_country', 'different_entity_kind')
    WHEN 'needs_information' THEN reason_code IN ('identity_unclear', 'details_missing')
    WHEN 'confirmed' THEN reason_code = 'identity_confirmed'
  END),
  FOREIGN KEY (tenant_id, match_id)
    REFERENCES assure.screening_match (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, decided_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX match_decision_match ON assure.match_decision (tenant_id, match_id, decided_at);
SELECT app.enable_tenant_rls('assure.match_decision');
SELECT app.deny_command('assure.match_decision', 'UPDATE');
SELECT app.deny_command('assure.match_decision', 'DELETE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.match_decision
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('decided_at');

CREATE FUNCTION assure.check_match_decision()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.outcome <> 'not_a_match' THEN
    PERFORM FROM assure.screening_match m
     WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.match_id
       AND m.subject_party_id IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Link the officer to a person before deciding anything but not a match.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_match_decision BEFORE INSERT ON assure.match_decision
  FOR EACH ROW EXECUTE FUNCTION assure.check_match_decision();

GRANT SELECT, INSERT (tenant_id, party_id, trigger, requested_by)
   ON assure.screening_run TO app_api;
GRANT SELECT, UPDATE (subject_party_id) ON assure.screening_match TO app_api;
GRANT SELECT, INSERT (tenant_id, match_id, outcome, reason_code, decided_by)
   ON assure.match_decision TO app_api;
GRANT SELECT, INSERT (tenant_id, party_id, trigger),
      UPDATE (status, list_id, list_last_checked_at, threshold, names_screened, matches_raised,
              error_code)
   ON assure.screening_run TO app_worker;
GRANT SELECT,
      INSERT (tenant_id, run_id, party_id, name_source, officer_id, subject_party_id,
              screened_name, list_id, designation_id, entry_kind, entry_name, regime,
              designated_on, dates_of_birth, nationalities, country, similarity)
   ON assure.screening_match TO app_worker;
GRANT SELECT ON assure.match_decision TO app_worker;
