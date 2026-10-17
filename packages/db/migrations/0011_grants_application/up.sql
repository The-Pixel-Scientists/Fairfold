-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0011, up: applications (S06-01), with their eligibility checks
-- and stage history, and the files linked to them (ADR 0047).
--
-- Every table is a tenant table under app.enable_tenant_rls(), with grants
-- to app_api alone, column by column, and a restrictive policy for each
-- command no app role is granted. Keys to other tables are composite with
-- tenant_id and ON DELETE RESTRICT: party.person and party.organisation
-- (ADR 0016), and a round's own form versions and stages through
-- (tenant_id, round_id, id). Ids and times come from the database; actors
-- are memberships of the same tenant. An application's submission and
-- withdrawal times are set by its trigger, not by the caller.
--
-- The statuses and outcomes copy the application contracts in
-- modules/grants/src/contracts/applications/lists.ts (S06-04), and the
-- field id format copies fieldIdSchema in packages/domain/src/forms.

-- An application to a round, pinned to one of the round's published form
-- versions (architecture rule 7). A draft is the applicant's own work: its
-- answers change, and submitting puts it in a stage of its round. A
-- submitted application moves between stages or is withdrawn, keeping its
-- submission time and stage, and a withdrawn one never changes. An
-- organisation has one live application per round. The API decides whether
-- a submission is late, from the round's closing time and late policy; the
-- database sets the submission time.
-- (tenant_id, round_id, id) lets later tables pin an application of a round.
CREATE TABLE grants.application (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  form_version_id uuid NOT NULL,
  applicant_person_id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'withdrawn')),
  answers jsonb NOT NULL DEFAULT '{}'
    CONSTRAINT application_answers_object CHECK (jsonb_typeof(answers) = 'object'),
  answers_version integer NOT NULL DEFAULT 1 CHECK (answers_version >= 1),
  stage_id uuid,
  submitted_at timestamptz,
  submitted_late boolean NOT NULL DEFAULT false,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, round_id, id),
  UNIQUE (tenant_id, id, form_version_id),
  CONSTRAINT application_status_times CHECK (CASE status
    WHEN 'draft' THEN submitted_at IS NULL AND stage_id IS NULL AND withdrawn_at IS NULL
                      AND NOT submitted_late
    WHEN 'submitted' THEN submitted_at IS NOT NULL AND stage_id IS NOT NULL
                          AND withdrawn_at IS NULL
    ELSE submitted_at IS NOT NULL AND stage_id IS NOT NULL AND withdrawn_at IS NOT NULL
         AND withdrawn_at >= submitted_at
  END),
  FOREIGN KEY (tenant_id, round_id) REFERENCES grants.round (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, round_id, form_version_id)
    REFERENCES grants.form_version (tenant_id, round_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, round_id, stage_id)
    REFERENCES grants.stage (tenant_id, round_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, applicant_person_id)
    REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES party.organisation (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX application_live_once ON grants.application (tenant_id, round_id, organisation_id)
  WHERE status <> 'withdrawn';
CREATE INDEX application_applicant ON grants.application (tenant_id, applicant_person_id);
CREATE INDEX application_organisation ON grants.application (tenant_id, organisation_id);
SELECT app.enable_tenant_rls('grants.application');
SELECT app.deny_command('grants.application', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.application
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- An application pins a published form version only, so its answers and
-- eligibility results belong to a definition that never changes. app_api
-- cannot update form_version_id, so only an insert needs checking. Like the
-- file link check below, it runs after the row-level security checks and
-- foreign keys, and its read runs under the caller's row-level security. A
-- published version never changes or goes away, so it needs no lock.
CREATE FUNCTION grants.check_application_form()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM grants.form_version f
    WHERE f.tenant_id = NEW.tenant_id AND f.round_id = NEW.round_id
      AND f.id = NEW.form_version_id AND f.status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An application pins a published form version only.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER check_application_form AFTER INSERT ON grants.application
  FOR EACH ROW EXECUTE FUNCTION grants.check_application_form();

-- The changes an application allows, whoever makes them: a draft's answers
-- change and it is submitted; a submitted one moves between stages or is
-- withdrawn. A draft is never withdrawn, an application never goes back to
-- draft, and a withdrawn one never changes. The submission and withdrawal
-- times are set here, to the transaction's time, whatever the caller sent.
CREATE FUNCTION grants.check_application_change()
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
CREATE TRIGGER check_application_change BEFORE UPDATE ON grants.application
  FOR EACH ROW EXECUTE FUNCTION grants.check_application_change();

GRANT SELECT,
      INSERT (tenant_id, round_id, form_version_id, applicant_person_id, organisation_id,
              created_by, updated_by),
      UPDATE (status, answers, answers_version, stage_id, submitted_late, updated_by)
   ON grants.application TO app_api;

-- One eligibility check of an application's answers, append-only. Its key
-- to (tenant_id, id, form_version_id) makes the version the one the
-- application pins. A stopped check names the field that stopped it.
CREATE TABLE grants.eligibility_result (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  form_version_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('eligible', 'stopped')),
  stopping_field_id text CHECK (stopping_field_id ~ '^f_[a-z0-9]{1,32}$'),
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT eligibility_result_stopping_field
    CHECK ((outcome = 'stopped') = (stopping_field_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, application_id, form_version_id)
    REFERENCES grants.application (tenant_id, id, form_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, checked_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX eligibility_result_application
  ON grants.eligibility_result (tenant_id, application_id, checked_at);
SELECT app.enable_tenant_rls('grants.eligibility_result');
SELECT app.deny_command('grants.eligibility_result', 'UPDATE');
SELECT app.deny_command('grants.eligibility_result', 'DELETE');
GRANT SELECT,
      INSERT (tenant_id, application_id, form_version_id, outcome, stopping_field_id, checked_by)
   ON grants.eligibility_result TO app_api;

-- One move of an application into a stage of its own round, append-only.
-- The first, at submission, comes from no stage.
CREATE TABLE grants.stage_transition (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  application_id uuid NOT NULL,
  from_stage_id uuid,
  to_stage_id uuid NOT NULL,
  moved_at timestamptz NOT NULL DEFAULT now(),
  moved_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT stage_transition_moves CHECK (from_stage_id <> to_stage_id),
  FOREIGN KEY (tenant_id, round_id, application_id)
    REFERENCES grants.application (tenant_id, round_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, round_id, from_stage_id)
    REFERENCES grants.stage (tenant_id, round_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, round_id, to_stage_id)
    REFERENCES grants.stage (tenant_id, round_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, moved_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX stage_transition_first_once ON grants.stage_transition (tenant_id, application_id)
  WHERE from_stage_id IS NULL;
CREATE INDEX stage_transition_application
  ON grants.stage_transition (tenant_id, application_id, moved_at);
SELECT app.enable_tenant_rls('grants.stage_transition');
SELECT app.deny_command('grants.stage_transition', 'UPDATE');
SELECT app.deny_command('grants.stage_transition', 'DELETE');
GRANT SELECT,
      INSERT (tenant_id, round_id, application_id, from_stage_id, to_stage_id, moved_by)
   ON grants.stage_transition TO app_api;

-- A clean file linked to one of an application's file questions (ADR 0047).
-- A file belongs to one application. Links are added and removed, never
-- changed, and only while the application is a draft.
CREATE TABLE grants.application_file (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  file_id uuid NOT NULL,
  field_id text NOT NULL CHECK (field_id ~ '^f_[a-z0-9]{1,32}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, file_id),
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES grants.application (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, file_id) REFERENCES app.file (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX application_file_application ON grants.application_file (tenant_id, application_id);
SELECT app.enable_tenant_rls('grants.application_file');
SELECT app.deny_command('grants.application_file', 'UPDATE');

-- A link is added or removed only while its application is a draft, and
-- only a clean file is linked. It runs after the row-level security checks
-- and foreign keys, and its reads run under the caller's row-level
-- security, so a row the caller cannot see passes neither. The application
-- row is locked, so a submission waits for the link, or the link sees the
-- submission.
CREATE FUNCTION grants.check_application_file()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  link grants.application_file;
BEGIN
  IF TG_OP = 'DELETE' THEN
    link := OLD;
  ELSE
    link := NEW;
  END IF;
  PERFORM FROM grants.application a
    WHERE a.tenant_id = link.tenant_id AND a.id = link.application_id AND a.status = 'draft'
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Files are added to or removed from a draft application only.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM FROM app.file f
      WHERE f.tenant_id = link.tenant_id AND f.id = link.file_id AND f.scan_state = 'clean';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only a file that has passed its virus scan can be linked.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER check_application_file AFTER INSERT OR DELETE ON grants.application_file
  FOR EACH ROW EXECUTE FUNCTION grants.check_application_file();

GRANT SELECT, DELETE,
      INSERT (tenant_id, id, application_id, file_id, field_id, created_by)
   ON grants.application_file TO app_api;
