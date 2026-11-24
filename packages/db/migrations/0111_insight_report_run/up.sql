-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0111, up: insight.report_run (B15-03, ADR 0032 rule 7), for
-- runReport, getReportRun and getMonitoringReportRun in
-- modules/insight/src/contracts/routes.ts. A run records who ran which
-- version of a report (created_by, created_at), its kind and outcome, and,
-- for a monitoring run, the disclosure rule version applied (null for the
-- platform floor), its question, breakdown and filter. Only a monitoring
-- table that was shown keeps the run log ADR 0032 needs: the rounds it
-- counted, its population and the suppressed table as shown. Nothing else
-- holds a figure: a warehouse run keeps none, and a withheld or refused run
-- keeps no count. The checks hold every stored count to zero or the
-- platform threshold or more, a suppressed cell to no count, and the
-- population to the minimum group or more; the trigger holds them to the
-- tenant's rule too, and the run to its report's current version. Runs are
-- append-only for every app role and kept while the tenant is a customer,
-- so the log covers every response still held. Only app_api, where the
-- disclosure engine runs, reads or writes a run. The server writes the
-- audit event with the actor from the session (rules 4 and 6).

ALTER TABLE insight.report_definition
  ADD CONSTRAINT report_definition_kind_key UNIQUE (tenant_id, id, kind);

CREATE TABLE insight.report_run (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  report_version integer NOT NULL CHECK (report_version > 0),
  kind text NOT NULL CHECK (kind IN ('warehouse', 'monitoring')),
  outcome text NOT NULL CHECK (outcome IN ('shown', 'withheld', 'refused')),
  disclosure_rule_version integer CHECK (disclosure_rule_version > 0),
  question text CHECK (question ~ '^[a-z][a-z0-9_]{0,62}$'),
  breakdown text CHECK (breakdown IN ('outcome', 'stage_reached')),
  filter_field text CHECK (filter_field IN ('programme', 'round', 'financial_year')),
  filter_id uuid,
  filter_year integer CHECK (filter_year BETWEEN 2000 AND 2100),
  round_ids uuid[]
    CONSTRAINT report_run_round_ids CHECK (
      cardinality(round_ids) BETWEEN 1 AND 10000 AND array_position(round_ids, NULL) IS NULL),
  population integer CONSTRAINT report_run_population_floor CHECK (population >= 20),
  shown_table jsonb
    CONSTRAINT report_run_shown_table CHECK (
      jsonb_typeof(shown_table) = 'object'
      AND octet_length(shown_table::text) <= 65536
      AND NOT jsonb_path_exists(shown_table, 'strict $.keyvalue() ? (!(@.key like_regex "^(columns|rows|totals)$"))')
      AND NOT jsonb_path_exists(shown_table, 'lax $.** ? (@.type() == "object").keyvalue() ? (@.value.type() == "number" && @.key != "count")')
      AND NOT jsonb_path_exists(shown_table, 'strict $.** ? (@.type() == "array")[*] ? (@.type() == "number")')
      AND NOT jsonb_path_exists(shown_table, 'lax $.** ? (@.type() == "object" && exists (@.count) && !(@.suppressed == false))')
      AND NOT jsonb_path_exists(shown_table, 'lax $.**.suppressed ? (@.type() != "boolean")')
      AND NOT jsonb_path_exists(shown_table, 'lax $.**.count ? (@.type() != "number" || @ != @.floor() || @ < 0 || (@ > 0 && @ < 10))')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT report_run_author CHECK (updated_by = created_by),
  CONSTRAINT report_run_kind CHECK (CASE kind
    WHEN 'warehouse' THEN outcome = 'shown'
      AND num_nulls(disclosure_rule_version, question, breakdown, filter_field, filter_id,
                    filter_year, round_ids, population, shown_table) = 9
    ELSE question IS NOT NULL
      AND (outcome = 'shown') = (round_ids IS NOT NULL)
      AND (outcome = 'shown') = (population IS NOT NULL)
      AND (outcome = 'shown') = (shown_table IS NOT NULL)
    END),
  CONSTRAINT report_run_filter CHECK (
    COALESCE(filter_field IN ('programme', 'round'), false) = (filter_id IS NOT NULL)
    AND COALESCE(filter_field = 'financial_year', false) = (filter_year IS NOT NULL)),
  FOREIGN KEY (tenant_id, report_id, kind)
    REFERENCES insight.report_definition (tenant_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX report_run_report ON insight.report_run (tenant_id, report_id, created_at);
CREATE INDEX report_run_log ON insight.report_run (tenant_id, question, breakdown)
  WHERE outcome = 'shown';
SELECT app.enable_tenant_rls('insight.report_run');
SELECT app.deny_command('insight.report_run', 'UPDATE');
SELECT app.deny_command('insight.report_run', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON insight.report_run
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON insight.report_run
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- A run is of its report's current version, never of an archived report.
-- A monitoring run applies the tenant's disclosure rule as it is now (no
-- row is the floor), and a shown table holds no count from 1 to below the
-- rule's threshold and no population below its minimum group. It runs after
-- the row-level security checks and foreign keys, and reads both rows under
-- the caller's row-level security.
CREATE FUNCTION insight.check_report_run()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  rule_version integer;
  rule_threshold integer := 10;
  rule_minimum integer := 20;
BEGIN
  PERFORM FROM insight.report_definition d
   WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.report_id
     AND d.version = NEW.report_version AND d.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A run is of its report''s current version, and an archived report is not run.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.kind = 'monitoring' THEN
    SELECT r.version, r.threshold, r.minimum_group
      INTO rule_version, rule_threshold, rule_minimum
      FROM insight.disclosure_rule r WHERE r.tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
      rule_threshold := 10;
      rule_minimum := 20;
    END IF;
    IF NEW.disclosure_rule_version IS DISTINCT FROM rule_version
       OR NEW.population < rule_minimum
       OR pg_catalog.jsonb_path_exists(NEW.shown_table, 'lax $.**.count ? (@ > 0 && @ < $t)',
                                       pg_catalog.jsonb_build_object('t', rule_threshold)) THEN
      RAISE EXCEPTION 'A monitoring run applies the tenant''s disclosure rule as it is now.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER check_report_run AFTER INSERT ON insight.report_run
  FOR EACH ROW EXECUTE FUNCTION insight.check_report_run();
GRANT SELECT,
      INSERT (tenant_id, report_id, report_version, kind, outcome, disclosure_rule_version,
              question, breakdown, filter_field, filter_id, filter_year, round_ids, population,
              shown_table, created_by, updated_by)
   ON insight.report_run TO app_api;
