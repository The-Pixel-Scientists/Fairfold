-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0051, up: reasonable adjustments, how an application was
-- submitted, and equality monitoring responses (S12-09, ADR 0032).
--
-- Both new tables are tenant tables under app.enable_tenant_rls(), with
-- column grants to app_api alone. Keys are composite with tenant_id and
-- ON DELETE RESTRICT. Triggers read other tables as the caller, under its
-- row-level security, and set the database's own times. Kinds, reason codes,
-- routes and the privacy notice format copy modules/grants/src/contracts.

-- Lets an adjustment name only an application of its own organisation and
-- round. Building this index blocks writes to grants.application; a large
-- tenant would want it built concurrently in a migration of its own.
ALTER TABLE grants.application
  ADD CONSTRAINT application_round_organisation_key
    UNIQUE (tenant_id, round_id, organisation_id, id);

-- A reasonable adjustment for an organisation in a round: more time, or
-- staff submitting for the applicant. Only an extension names an
-- application. There is no free-text reason, and a reason code can reveal
-- health, so it never goes in an audit value. Revoking is the one change,
-- and happens once; the actor comes from the session.
CREATE TABLE grants.adjustment (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  application_id uuid,
  kind text NOT NULL CHECK (kind IN ('deadline_extension', 'alternative_route')),
  closes_at timestamptz,
  reason_code text NOT NULL CHECK (reason_code IN (
    'access_needs', 'caring_responsibilities', 'technical_problem', 'bereavement', 'other')),
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason_code text CHECK (revoke_reason_code IN (
    'no_longer_needed', 'applicant_asked', 'granted_in_error', 'other')),
  UNIQUE (tenant_id, id),
  CONSTRAINT adjustment_closes_at_kind
    CHECK ((kind = 'deadline_extension') = (closes_at IS NOT NULL)),
  CONSTRAINT adjustment_application_extension
    CHECK (application_id IS NULL OR kind = 'deadline_extension'),
  CONSTRAINT adjustment_revocation
    CHECK (num_nulls(revoked_by, revoked_at, revoke_reason_code) IN (0, 3)),
  FOREIGN KEY (tenant_id, round_id) REFERENCES grants.round (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES party.organisation (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, round_id, organisation_id, application_id)
    REFERENCES grants.application (tenant_id, round_id, organisation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, granted_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, revoked_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX adjustment_round_organisation
  ON grants.adjustment (tenant_id, round_id, organisation_id);
SELECT app.enable_tenant_rls('grants.adjustment');
SELECT app.deny_command('grants.adjustment', 'DELETE');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE ON grants.adjustment
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('organisation_id');

-- An extension must close after its round. This runs before row-level
-- security and foreign keys, so a round the caller cannot see is left for
-- them to refuse. The grant time is the database's, and a new adjustment is
-- not revoked, whatever the caller sent.
CREATE FUNCTION grants.check_new_adjustment()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.granted_at := pg_catalog.now();
  NEW.revoked_at := NULL;
  IF NEW.closes_at IS NOT NULL THEN
    PERFORM FROM grants.round r
      WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.round_id AND r.closes_at >= NEW.closes_at;
    IF FOUND THEN
      RAISE EXCEPTION 'An extension must close after its round does.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_new_adjustment BEFORE INSERT ON grants.adjustment
  FOR EACH ROW EXECUTE FUNCTION grants.check_new_adjustment();

-- Only the revocation columns change, and only once. The revocation time is
-- the database's. A revocation with no revoked_by fails adjustment_revocation.
CREATE FUNCTION grants.keep_adjustment()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'A revoked adjustment never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.round_id, NEW.organisation_id, NEW.application_id, NEW.kind,
      NEW.closes_at, NEW.reason_code, NEW.granted_by, NEW.granted_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.id, OLD.round_id, OLD.organisation_id, OLD.application_id, OLD.kind,
      OLD.closes_at, OLD.reason_code, OLD.granted_by, OLD.granted_at) THEN
    RAISE EXCEPTION 'Only the revocation of an adjustment can change.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.revoked_at := CASE WHEN NEW.revoked_by IS NOT NULL THEN pg_catalog.now() END;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_adjustment BEFORE UPDATE ON grants.adjustment
  FOR EACH ROW EXECUTE FUNCTION grants.keep_adjustment();

GRANT SELECT,
      INSERT (tenant_id, round_id, organisation_id, application_id, kind, closes_at, reason_code,
              granted_by),
      UPDATE (revoked_by, revoke_reason_code)
   ON grants.adjustment TO app_api;

-- How an application was submitted: by the applicant, or by the named
-- member. A constant default is stored in the catalogue on PostgreSQL 16,
-- so adding these columns rewrites no row. A draft has no submitter yet.
ALTER TABLE grants.application
  ADD COLUMN submission_route text NOT NULL DEFAULT 'portal'
    CONSTRAINT application_submission_route CHECK (submission_route IN ('portal', 'assisted')),
  ADD COLUMN submitted_by uuid,
  ADD CONSTRAINT application_submitted_by
    CHECK ((submitted_by IS NOT NULL) = (submission_route = 'assisted' AND status <> 'draft')),
  ADD CONSTRAINT application_submitted_by_member FOREIGN KEY (tenant_id, submitted_by)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT;

-- The route and its member are fixed once the application has left draft.
CREATE FUNCTION grants.keep_application_route()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.status <> 'draft'
     AND (NEW.submission_route, NEW.submitted_by) IS DISTINCT FROM
         (OLD.submission_route, OLD.submitted_by) THEN
    RAISE EXCEPTION 'The submission route of a submitted application never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_application_route BEFORE UPDATE ON grants.application
  FOR EACH ROW EXECUTE FUNCTION grants.keep_application_route();

-- A backstop for the server's check: staff submit only while the organisation
-- has a live alternative route in the round. The lock makes a revocation
-- wait for the submission, or the submission see the revocation.
CREATE FUNCTION grants.check_assisted_submission()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM grants.adjustment a
    WHERE a.tenant_id = NEW.tenant_id AND a.round_id = NEW.round_id
      AND a.organisation_id = NEW.organisation_id
      AND a.kind = 'alternative_route' AND a.revoked_at IS NULL
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff can submit only with a live alternative route.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_assisted_submission BEFORE UPDATE ON grants.application
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status = 'submitted' AND NEW.submission_route = 'assisted')
  EXECUTE FUNCTION grants.check_assisted_submission();

GRANT UPDATE (submission_route, submitted_by) ON grants.application TO app_api;

-- The subject access export reads the route, which the applicant is told.
-- Who submitted is never shown to them, so the worker cannot read it.
GRANT SELECT (submission_route) ON grants.application TO app_worker;

-- An applicant's equality monitoring answers (ADR 0032), under their own
-- consent, kept apart from everything staff read. No view, foreign key or
-- other role's grant may reach this table. A row exists only with consent;
-- a changed answer is a withdrawal and a new response, so withdrawal deletes
-- the row. The answers are keyed by stable field id, against the form version
-- they were given for (rule 7).
CREATE TABLE grants.monitoring_response (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  application_id uuid NOT NULL,
  form_version_id uuid NOT NULL,
  answers jsonb NOT NULL CONSTRAINT monitoring_response_answers CHECK (
    jsonb_typeof(answers) = 'object'
    AND NOT jsonb_path_exists(answers, '$.keyvalue() ? (!(@.key like_regex "^f_[a-z0-9]{1,32}$"))')),
  consent_given_at timestamptz NOT NULL DEFAULT now(),
  privacy_notice_version text NOT NULL
    CHECK (privacy_notice_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id),
  FOREIGN KEY (tenant_id, round_id, application_id)
    REFERENCES grants.application (tenant_id, round_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, round_id, form_version_id)
    REFERENCES grants.form_version (tenant_id, round_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.monitoring_response');
SELECT app.deny_command('grants.monitoring_response', 'UPDATE');

-- No response is added or changed for an erased applicant (ADR 0027). The
-- applicant is read as the caller, under its row-level security. The consent
-- and creation times are the database's, whatever the caller sent.
CREATE FUNCTION grants.check_monitoring_response()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  applicant uuid;
BEGIN
  SELECT a.applicant_person_id INTO applicant
    FROM grants.application a
   WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.application_id;
  IF party.is_erased(NEW.tenant_id, applicant) THEN
    RAISE EXCEPTION 'An erased applicant''s monitoring answers never change.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.consent_given_at := pg_catalog.now();
    NEW.created_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_monitoring_response BEFORE INSERT OR UPDATE ON grants.monitoring_response
  FOR EACH ROW EXECUTE FUNCTION grants.check_monitoring_response();

GRANT SELECT, DELETE,
      INSERT (tenant_id, round_id, application_id, form_version_id, answers, privacy_notice_version)
   ON grants.monitoring_response TO app_api;
