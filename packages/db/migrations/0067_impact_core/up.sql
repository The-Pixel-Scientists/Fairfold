-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0067, up: the impact schema (ADR 0016): outcomes frameworks
-- with their outcomes and indicators, targets, results with their evidence,
-- and learning notes. Lists, caps and figure rules copy the contracts in
-- modules/impact/src/contracts; test/impact/contracts.test.ts reads them
-- back.
--
-- No impact table names a party. Results are totals about the work, and a
-- name, description, note or caption is staff's words about that work, which
-- must not name a person, as a crm list's description must not. A
-- programme is named by its id alone, with no foreign key: grants does not
-- publish that key (ADR 0016), so the server checks it through grants'
-- contract.
--
-- Every table is a tenant table under app.enable_tenant_rls(), with column
-- grants. Times come from the database. Text is as line() and paragraphs()
-- leave it, with the same patterns as migration 0009. The migration writes
-- no audit event or config version, and no trigger does: the server writes
-- both with the actor from the session (rules 4, 6 and 10).

CREATE SCHEMA impact AUTHORIZATION migrator;
REVOKE ALL ON SCHEMA impact FROM PUBLIC;
GRANT USAGE ON SCHEMA impact TO app_api;

-- archived_at takes the database's time and, once set, stays.
CREATE FUNCTION impact.set_archived_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'An archived row stays archived.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    NEW.archived_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;

-- Rule 10: a change to the name or description raises the version by
-- exactly one, and the version otherwise stays or rises by one, which is how
-- the server records a change to the framework's outcomes or indicators. It
-- writes the matching app.config_version row (entity type impact.framework,
-- the same version, the diff from frameworkDiff) in the same transaction.
-- An archived framework changes no more.
CREATE FUNCTION impact.check_framework_version()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'An archived framework never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF (NEW.name, NEW.description) IS DISTINCT FROM (OLD.name, OLD.description) THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'A framework change raises its version by one.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.version NOT IN (OLD.version, OLD.version + 1) THEN
    RAISE EXCEPTION 'A framework''s version stays or rises by one.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TABLE impact.framework (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200)
    CONSTRAINT framework_name_text CHECK (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) BETWEEN 0 AND 2000)
    CONSTRAINT framework_description_text CHECK (description !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
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
CREATE UNIQUE INDEX framework_name_unique ON impact.framework (tenant_id, lower(name))
  WHERE archived_at IS NULL;
SELECT app.enable_tenant_rls('impact.framework');
SELECT app.deny_command('impact.framework', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON impact.framework
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON impact.framework
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_archived_at BEFORE UPDATE OF archived_at ON impact.framework
  FOR EACH ROW EXECUTE FUNCTION impact.set_archived_at();
CREATE TRIGGER check_framework_version BEFORE UPDATE ON impact.framework
  FOR EACH ROW EXECUTE FUNCTION impact.check_framework_version();
GRANT SELECT, INSERT (tenant_id, name, description, created_by, updated_by),
      UPDATE (name, description, version, archived_at, updated_by)
   ON impact.framework TO app_api;

-- Nothing is added to, changed in or removed from an archived framework.
-- The row names its framework in framework_id. Reads the framework as the
-- caller, and locks it against a concurrent archive.
CREATE FUNCTION impact.refuse_archived()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  changed record;
  archived timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN changed := OLD; ELSE changed := NEW; END IF;
  SELECT f.archived_at INTO archived
    FROM impact.framework f
   WHERE f.tenant_id = changed.tenant_id AND f.id = changed.framework_id
     FOR SHARE;
  IF archived IS NOT NULL THEN
    RAISE EXCEPTION 'An archived framework never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN changed;
END
$function$;

-- An outcome's id is made by the console, so a rename keeps it and the
-- config diff names it. position orders a framework's outcomes.
CREATE TABLE impact.outcome (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  framework_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200)
    CONSTRAINT outcome_name_text CHECK (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) BETWEEN 0 AND 2000)
    CONSTRAINT outcome_description_text CHECK (description !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 49),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, framework_id, id),
  FOREIGN KEY (tenant_id, framework_id) REFERENCES impact.framework (tenant_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX outcome_framework ON impact.outcome (tenant_id, framework_id, position);
SELECT app.enable_tenant_rls('impact.outcome');
CREATE TRIGGER set_created_at BEFORE INSERT ON impact.outcome
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON impact.outcome
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_archived BEFORE INSERT OR UPDATE OR DELETE ON impact.outcome
  FOR EACH ROW EXECUTE FUNCTION impact.refuse_archived();
GRANT SELECT, DELETE, INSERT (tenant_id, id, framework_id, name, description, position),
      UPDATE (name, description, position)
   ON impact.outcome TO app_api;

-- An indicator stays in its framework, and its outcome is one of that
-- framework's. Its unit is fixed once a target or result exists for it.
CREATE TABLE impact.indicator (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  framework_id uuid NOT NULL,
  outcome_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200)
    CONSTRAINT indicator_name_text CHECK (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  unit text NOT NULL CHECK (unit IN ('count', 'people', 'percentage', 'money', 'hours', 'number')),
  direction text NOT NULL CHECK (direction IN ('increase', 'decrease')),
  aggregation text NOT NULL CHECK (aggregation IN ('sum', 'average', 'latest')),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 149),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, framework_id, id),
  FOREIGN KEY (tenant_id, framework_id, outcome_id)
    REFERENCES impact.outcome (tenant_id, framework_id, id) ON DELETE RESTRICT
);
CREATE INDEX indicator_framework ON impact.indicator (tenant_id, framework_id, position);
CREATE INDEX indicator_outcome ON impact.indicator (tenant_id, framework_id, outcome_id);
SELECT app.enable_tenant_rls('impact.indicator');
CREATE TRIGGER set_created_at BEFORE INSERT ON impact.indicator
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON impact.indicator
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_archived BEFORE INSERT OR UPDATE OR DELETE ON impact.indicator
  FOR EACH ROW EXECUTE FUNCTION impact.refuse_archived();
GRANT SELECT, DELETE,
      INSERT (tenant_id, id, framework_id, outcome_id, name, unit, direction, aggregation,
              position),
      UPDATE (outcome_id, name, unit, direction, aggregation, position)
   ON impact.indicator TO app_api;

-- A figure fits its indicator's unit: counts, people and money (in minor
-- units, ADR 0041) are whole, and a percentage is at most 100. The trigger's
-- arguments name the row's figure columns; a null figure is none. Reads the
-- indicator as the caller and locks it, so its unit cannot change under a
-- figure being written.
CREATE FUNCTION impact.check_figures()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  indicator_unit text;
  figure numeric;
  figure_column text;
BEGIN
  SELECT i.unit INTO indicator_unit
    FROM impact.indicator i
   WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.indicator_id
     FOR SHARE;
  FOREACH figure_column IN ARRAY TG_ARGV LOOP
    figure := (pg_catalog.to_jsonb(NEW) ->> figure_column)::numeric;
    IF figure IS NULL THEN
      CONTINUE;
    END IF;
    IF indicator_unit IN ('count', 'people', 'money') AND figure <> pg_catalog.trunc(figure) THEN
      RAISE EXCEPTION 'A figure for this unit is a whole number.' USING ERRCODE = 'check_violation';
    END IF;
    IF indicator_unit = 'percentage' AND figure > 100 THEN
      RAISE EXCEPTION 'A percentage is at most 100.' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

-- The figure an indicator should reach over a period, for one programme or,
-- with no programme, for the funder as a whole: one target for each. A
-- target stays with its indicator, programme and period.
CREATE TABLE impact.target (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id uuid NOT NULL,
  indicator_id uuid NOT NULL,
  programme_id uuid,
  period_start date NOT NULL,
  period_end date NOT NULL,
  baseline numeric(15, 2) CHECK (baseline BETWEEN 0 AND 1000000000000),
  target numeric(15, 2) NOT NULL CHECK (target BETWEEN 0 AND 1000000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT target_once UNIQUE NULLS NOT DISTINCT
    (tenant_id, indicator_id, programme_id, period_start, period_end),
  CONSTRAINT target_period CHECK (period_start <= period_end),
  FOREIGN KEY (tenant_id, framework_id, indicator_id)
    REFERENCES impact.indicator (tenant_id, framework_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX target_framework ON impact.target (tenant_id, framework_id, indicator_id, period_start);
SELECT app.enable_tenant_rls('impact.target');
CREATE TRIGGER set_created_at BEFORE INSERT ON impact.target
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON impact.target
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_archived BEFORE INSERT OR UPDATE OR DELETE ON impact.target
  FOR EACH ROW EXECUTE FUNCTION impact.refuse_archived();
CREATE TRIGGER check_figures BEFORE INSERT OR UPDATE OF baseline, target ON impact.target
  FOR EACH ROW EXECUTE FUNCTION impact.check_figures('baseline', 'target');
GRANT SELECT, DELETE,
      INSERT (tenant_id, framework_id, indicator_id, programme_id, period_start, period_end,
              baseline, target, created_by, updated_by),
      UPDATE (baseline, target, updated_by)
   ON impact.target TO app_api;

-- The figure reported for an indicator over a period. A result stays with
-- its indicator, programme and period; a correction changes its figure or
-- note, and one recorded by mistake is deleted, with the audit events
-- impact.result.corrected and impact.result.removed keeping the history.
CREATE TABLE impact.result (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id uuid NOT NULL,
  indicator_id uuid NOT NULL,
  programme_id uuid,
  period_start date NOT NULL,
  period_end date NOT NULL,
  value numeric(15, 2) NOT NULL CHECK (value BETWEEN 0 AND 1000000000000),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) BETWEEN 0 AND 2000)
    CONSTRAINT result_note_text CHECK (note !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'monitoring_report')),
  recorded_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, framework_id, id),
  CONSTRAINT result_period CHECK (period_start <= period_end),
  FOREIGN KEY (tenant_id, framework_id, indicator_id)
    REFERENCES impact.indicator (tenant_id, framework_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES app.membership (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX result_framework
  ON impact.result (tenant_id, framework_id, period_end DESC, id);
CREATE INDEX result_indicator ON impact.result (tenant_id, indicator_id, period_end DESC);
CREATE INDEX result_programme ON impact.result (tenant_id, programme_id)
  WHERE programme_id IS NOT NULL;
SELECT app.enable_tenant_rls('impact.result');
CREATE TRIGGER set_created_at BEFORE INSERT ON impact.result
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON impact.result
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER refuse_archived BEFORE INSERT OR UPDATE OR DELETE ON impact.result
  FOR EACH ROW EXECUTE FUNCTION impact.refuse_archived();
CREATE TRIGGER check_figures BEFORE INSERT OR UPDATE OF value ON impact.result
  FOR EACH ROW EXECUTE FUNCTION impact.check_figures('value');
GRANT SELECT, DELETE,
      INSERT (tenant_id, framework_id, indicator_id, programme_id, period_start, period_end,
              value, note, recorded_by, updated_by),
      UPDATE (value, note, updated_by)
   ON impact.result TO app_api;

-- An indicator's unit is fixed once it has a target or a result. The figure
-- trigger's lock on the indicator keeps one from arriving while this looks.
CREATE FUNCTION impact.keep_unit()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.unit IS DISTINCT FROM OLD.unit AND (
       EXISTS (SELECT FROM impact.target t
                WHERE t.tenant_id = OLD.tenant_id AND t.indicator_id = OLD.id)
       OR EXISTS (SELECT FROM impact.result r
                   WHERE r.tenant_id = OLD.tenant_id AND r.indicator_id = OLD.id)) THEN
    RAISE EXCEPTION 'An indicator''s unit is fixed once it has targets or results.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_unit BEFORE UPDATE OF unit ON impact.indicator
  FOR EACH ROW EXECUTE FUNCTION impact.keep_unit();

-- A join's triggers link a clean file when its row is added and release it
-- when the row goes (ADR 0030, "One file, one link").
CREATE FUNCTION impact.link_file()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM app.link_file(NEW.file_id);
  ELSE
    PERFORM app.release_file(OLD.file_id);
  END IF;
  RETURN NULL;
END
$function$;

-- A result's evidence: a file and a caption that says what it shows. A
-- caption changes in place, so a kept file is never released and linked
-- again. framework_id copies the result's, so the archive rule reaches it.
CREATE TABLE impact.result_evidence (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id uuid NOT NULL,
  result_id uuid NOT NULL,
  file_id uuid NOT NULL,
  caption text NOT NULL CHECK (char_length(caption) BETWEEN 1 AND 200)
    CONSTRAINT result_evidence_caption_text CHECK (caption !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  added_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, file_id),
  FOREIGN KEY (tenant_id, framework_id, result_id)
    REFERENCES impact.result (tenant_id, framework_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, file_id) REFERENCES app.file (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, added_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX result_evidence_result ON impact.result_evidence (tenant_id, result_id);
SELECT app.enable_tenant_rls('impact.result_evidence');
CREATE TRIGGER set_created_at BEFORE INSERT ON impact.result_evidence
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER refuse_archived BEFORE INSERT OR UPDATE OR DELETE ON impact.result_evidence
  FOR EACH ROW EXECUTE FUNCTION impact.refuse_archived();
CREATE TRIGGER link_file AFTER INSERT OR DELETE ON impact.result_evidence
  FOR EACH ROW EXECUTE FUNCTION impact.link_file();
GRANT SELECT, DELETE,
      INSERT (tenant_id, framework_id, result_id, file_id, caption, added_by),
      UPDATE (caption)
   ON impact.result_evidence TO app_api;

-- What staff learned from the results, for a framework or one of its
-- outcomes. A note is added or removed, never edited.
CREATE TABLE impact.learning_note (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id uuid NOT NULL,
  outcome_id uuid,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000)
    CONSTRAINT learning_note_body_text CHECK (body !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, framework_id) REFERENCES impact.framework (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, framework_id, outcome_id)
    REFERENCES impact.outcome (tenant_id, framework_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX learning_note_framework
  ON impact.learning_note (tenant_id, framework_id, created_at DESC);
SELECT app.enable_tenant_rls('impact.learning_note');
SELECT app.deny_command('impact.learning_note', 'UPDATE');
CREATE TRIGGER set_created_at BEFORE INSERT ON impact.learning_note
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER refuse_archived BEFORE INSERT OR DELETE ON impact.learning_note
  FOR EACH ROW EXECUTE FUNCTION impact.refuse_archived();
GRANT SELECT, DELETE, INSERT (tenant_id, framework_id, outcome_id, body, created_by)
   ON impact.learning_note TO app_api;
