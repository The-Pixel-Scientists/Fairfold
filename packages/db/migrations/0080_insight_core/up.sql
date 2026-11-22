-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0080, up: the insight schema (ADR 0016): report definitions,
-- the tenant's disclosure rule (ADR 0032) and regulatory publication runs.
-- Lists, caps and the disclosure floor copy the contracts in
-- modules/insight/src/contracts; test/insight/contracts.test.ts reads them
-- back.
--
-- No insight table names a person, and no aggregate is stored here (ADR
-- 0032). A report's definition is configuration: codes, ids and column
-- names, with a name, description and filter values that are staff's words
-- about the work, which must not name a person, as a crm list's description
-- must not. Report definitions and the disclosure rule are versioned
-- configuration (rule 10): the server writes the matching app.config_version
-- row (entity type insight.report_definition or insight.disclosure_rule,
-- entity id the row's id, the same version) in the same transaction. A
-- tenant without a rule row has the platform floor; the migration writes no
-- row.
--
-- Every table is a tenant table under app.enable_tenant_rls(), with column
-- grants, and no app role may delete from it, so switching insight off keeps
-- every row. Times come from the database. The migration writes no audit
-- event or config version, and no trigger does: the server writes both with
-- the actor from the session (rules 4, 6 and 10). Nothing here submits to a
-- regulator: only app_api marks a run submitted, after a member's action.

CREATE SCHEMA insight AUTHORIZATION migrator;
REVOKE ALL ON SCHEMA insight FROM PUBLIC;
GRANT USAGE ON SCHEMA insight TO app_api, app_worker;

-- A change to the name or definition raises the version by exactly one, and
-- the version moves with nothing else. archived_at takes the database's time,
-- and an archived report never changes.
CREATE FUNCTION insight.check_definition_version()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'An archived report never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.archived_at IS NOT NULL THEN
    NEW.archived_at := pg_catalog.now();
  END IF;
  IF NEW.version <> OLD.version
       + ((NEW.name, NEW.definition) IS DISTINCT FROM (OLD.name, OLD.definition))::integer THEN
    RAISE EXCEPTION 'A report change raises its version by one.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

-- definition holds the rest of reportDefinitionInputSchema: description,
-- source, measures, groups and filters, keyed by item id.
CREATE TABLE insight.report_definition (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('warehouse', 'monitoring')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200)
    CONSTRAINT report_definition_name_text CHECK (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'
                                   AND octet_length(definition::text) <= 65536),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX report_definition_name_unique
  ON insight.report_definition (tenant_id, lower(name)) WHERE archived_at IS NULL;
SELECT app.enable_tenant_rls('insight.report_definition');
SELECT app.deny_command('insight.report_definition', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON insight.report_definition
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON insight.report_definition
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER check_definition_version BEFORE UPDATE ON insight.report_definition
  FOR EACH ROW EXECUTE FUNCTION insight.check_definition_version();
GRANT SELECT, INSERT (tenant_id, kind, name, definition, created_by, updated_by),
      UPDATE (name, definition, version, archived_at, updated_by)
   ON insight.report_definition TO app_api;
GRANT SELECT ON insight.report_definition TO app_worker;

-- A change to the threshold or minimum group raises the version by exactly
-- one, and the version moves with nothing else.
CREATE FUNCTION insight.check_rule_version()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.version <> OLD.version + ((NEW.threshold, NEW.minimum_group)
       IS DISTINCT FROM (OLD.threshold, OLD.minimum_group))::integer THEN
    RAISE EXCEPTION 'A disclosure rule change raises its version by one.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

-- The floor checks hold disclosureFloor; only a migration lowers them. A
-- tenant without a row has the floor. Secondary suppression always applies,
-- so no column turns it off.
CREATE TABLE insight.disclosure_rule (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  threshold integer NOT NULL
    CONSTRAINT disclosure_rule_threshold_floor CHECK (threshold BETWEEN 10 AND 1000),
  minimum_group integer NOT NULL
    CONSTRAINT disclosure_rule_minimum_group_floor CHECK (minimum_group BETWEEN 20 AND 10000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id),
  UNIQUE (tenant_id, id),
  CONSTRAINT disclosure_rule_group_covers_threshold CHECK (minimum_group >= threshold),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('insight.disclosure_rule');
SELECT app.deny_command('insight.disclosure_rule', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON insight.disclosure_rule
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON insight.disclosure_rule
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER check_rule_version BEFORE UPDATE ON insight.disclosure_rule
  FOR EACH ROW EXECUTE FUNCTION insight.check_rule_version();
GRANT SELECT, INSERT (tenant_id, threshold, minimum_group, created_by, updated_by),
      UPDATE (threshold, minimum_group, version, updated_by)
   ON insight.disclosure_rule TO app_api;
GRANT SELECT ON insight.disclosure_rule TO app_worker;

-- A run moves only from preparing to prepared or failed, and from prepared
-- to submitted. Its kind, period and preparer never change; its output or
-- error code is set as it leaves preparing and then stays, and so does who
-- submitted it. submitted_at takes the database's time when it is submitted.
-- Its output is a tenant file that has passed its virus scan, is not erased
-- and was never linked (ADR 0030), held FOR SHARE while the run takes it.
-- The run does not link it yet: app_worker has no right to link a file.
CREATE FUNCTION insight.check_run_state()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.submitted_at := CASE WHEN NEW.state = 'submitted' THEN pg_catalog.now() END;
    RETURN NEW;
  END IF;
  IF (NEW.kind, NEW.period_start, NEW.period_end, NEW.prepared_by)
       IS DISTINCT FROM (OLD.kind, OLD.period_start, OLD.period_end, OLD.prepared_by)
     OR (OLD.state <> 'preparing' AND (NEW.output_file_id, NEW.error_code)
           IS DISTINCT FROM (OLD.output_file_id, OLD.error_code))
     OR (OLD.state = 'submitted' AND NEW.submitted_by IS DISTINCT FROM OLD.submitted_by) THEN
    RAISE EXCEPTION 'A publication run keeps its kind, period, preparer, output and submitter.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.state <> OLD.state
     AND NOT (OLD.state = 'preparing' AND NEW.state IN ('prepared', 'failed'))
     AND NOT (OLD.state = 'prepared' AND NEW.state = 'submitted') THEN
    RAISE EXCEPTION 'A publication run moves only from preparing to prepared or failed, then to submitted.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.output_file_id IS DISTINCT FROM OLD.output_file_id THEN
    PERFORM FROM app.file f
      WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.output_file_id
        AND f.scan_state = 'clean' AND f.linked_at IS NULL AND f.erased_at IS NULL
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A run''s output is a file that has passed its virus scan and was never linked.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;
  NEW.submitted_at := CASE
    WHEN NEW.state <> 'submitted' THEN NULL
    WHEN OLD.state = 'submitted' THEN OLD.submitted_at
    ELSE pg_catalog.now()
  END;
  RETURN NEW;
END
$function$;

-- app_worker prepares a run (S12-60's job) and cannot submit one: it has no
-- grant on submitted_by, which a submitted run must have.
CREATE TABLE insight.publication_run (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('three_sixty_giving', 'sorp_grant_note', 'annual_return')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  state text NOT NULL DEFAULT 'preparing'
    CHECK (state IN ('preparing', 'prepared', 'failed', 'submitted')),
  output_file_id uuid,
  error_code text CHECK (error_code ~ '^[a-z_]{1,64}$'),
  prepared_by uuid NOT NULL,
  submitted_by uuid,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT publication_run_period CHECK (period_start < period_end),
  CONSTRAINT publication_run_output CHECK
    ((state IN ('prepared', 'submitted')) = (output_file_id IS NOT NULL)),
  CONSTRAINT publication_run_failed CHECK ((state = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT publication_run_submitted CHECK ((state = 'submitted') = (submitted_by IS NOT NULL)
                                              AND (submitted_by IS NULL) = (submitted_at IS NULL)),
  FOREIGN KEY (tenant_id, output_file_id) REFERENCES app.file (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, prepared_by) REFERENCES app.membership (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, submitted_by) REFERENCES app.membership (tenant_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX publication_run_newest ON insight.publication_run (tenant_id, created_at DESC);
SELECT app.enable_tenant_rls('insight.publication_run');
SELECT app.deny_command('insight.publication_run', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON insight.publication_run
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON insight.publication_run
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER check_run_state BEFORE INSERT OR UPDATE ON insight.publication_run
  FOR EACH ROW EXECUTE FUNCTION insight.check_run_state();
GRANT SELECT, INSERT (tenant_id, kind, period_start, period_end, prepared_by),
      UPDATE (state, submitted_by)
   ON insight.publication_run TO app_api;
GRANT SELECT, UPDATE (state, output_file_id, error_code)
   ON insight.publication_run TO app_worker;
