-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0013, up: decisions (S09-01): one private decision per
-- application, fixed once released (architecture rule 8); the outbox of
-- release emails (ADR 0020); and each tenant's 360Giving publisher details.
--
-- Every table is a tenant table under app.enable_tenant_rls(), with grants
-- to app_api alone, column by column, and a restrictive policy for each
-- command no app role is granted. Keys are composite with tenant_id and
-- ON DELETE RESTRICT. Ids and times come from the database; actors are
-- memberships of the same tenant.
--
-- The outcomes copy modules/grants/src/contracts/programme/lists.ts, the
-- amount bound MAX_AMOUNT_MINOR in programme/inputs.ts, and the email
-- statuses and error codes decisions/lists.ts (S08-04). Money is in minor
-- units of GBP (ADR 0016).

-- An application's decision. An award has its amount and currency, and no
-- other outcome has either. It is recorded, and changed, privately, then
-- released: released_by and released_at are set together, and releasing
-- is the last change a decision ever takes.
CREATE TABLE grants.decision (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'waitlisted', 'declined')),
  amount_minor bigint CHECK (amount_minor BETWEEN 1 AND 100000000000),
  currency text CHECK (currency = 'GBP'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL,
  released_at timestamptz,
  released_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  CONSTRAINT decision_once UNIQUE (tenant_id, application_id),
  CONSTRAINT decision_amount CHECK (
    ((outcome = 'accepted') = (amount_minor IS NOT NULL))
    AND ((amount_minor IS NULL) = (currency IS NULL))),
  CONSTRAINT decision_released CHECK ((released_at IS NULL) = (released_by IS NULL)),
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES grants.application (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, released_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.decision');
SELECT app.deny_command('grants.decision', 'DELETE');
-- An update reaches unreleased decisions only, so a released one never
-- changes. It applies to every role that row-level security binds, the
-- table's owner included. WITH CHECK (true) lets the release itself
-- through.
CREATE POLICY unreleased_update ON grants.decision AS RESTRICTIVE FOR UPDATE TO PUBLIC
  USING (released_at IS NULL) WITH CHECK (true);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.decision
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- A decision is recorded only on a submitted application, never on a draft
-- whose answers can still change or on a withdrawn one. It needs no lock:
-- an applicant may withdraw until the decision is released, so a
-- withdrawal committed alongside leaves what a withdrawal just after the
-- recording would, an unreleased decision that check_decision_change()
-- then never lets change or be released. Like the checks in migration
-- 0012, it runs after the row-level security checks and foreign keys, and
-- its read runs under the caller's row-level security.
CREATE FUNCTION grants.check_decision_application()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM grants.application a
    WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.application_id AND a.status = 'submitted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A decision is recorded only on a submitted application.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER check_decision_application AFTER INSERT ON grants.decision
  FOR EACH ROW EXECUTE FUNCTION grants.check_decision_application();

-- Only unreleased decisions reach this, so a releaser means this update
-- releases it. Every update, a change or a release, needs the application
-- still submitted: a withdrawn application's decision is never changed or
-- released. The share lock on the application row makes a concurrent
-- withdrawal wait for this transaction, or this check wait for the
-- withdrawal and then see it. A release keeps the outcome as it was
-- recorded. The recording and release times are the transaction's,
-- whatever the caller sent.
CREATE FUNCTION grants.check_decision_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM grants.application a
    WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.application_id AND a.status = 'submitted'
    FOR SHARE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A decision is changed or released only while its application is submitted.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF (NEW.outcome, NEW.amount_minor, NEW.currency)
     IS DISTINCT FROM (OLD.outcome, OLD.amount_minor, OLD.currency) THEN
    IF NEW.released_by IS NOT NULL THEN
      RAISE EXCEPTION 'A decision is released as it was recorded.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    NEW.recorded_at := pg_catalog.now();
  END IF;
  IF NEW.released_by IS NOT NULL THEN
    NEW.released_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_decision_change BEFORE UPDATE ON grants.decision
  FOR EACH ROW EXECUTE FUNCTION grants.check_decision_change();

-- An application is withdrawn only while its decision, if it has one, is
-- unreleased: a released decision stands, and its application with it.
-- The update locks the application row before this runs, so a release in
-- flight either commits first, and this sees it, or waits for the
-- withdrawal and is then refused by check_decision_change(). Its read runs
-- under the caller's row-level security.
CREATE FUNCTION grants.check_application_withdrawal()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM grants.decision d
    WHERE d.tenant_id = NEW.tenant_id AND d.application_id = NEW.id
      AND d.released_at IS NOT NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'An application whose decision is released cannot be withdrawn.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_application_withdrawal BEFORE UPDATE ON grants.application
  FOR EACH ROW WHEN (OLD.status = 'submitted' AND NEW.status = 'withdrawn')
  EXECUTE FUNCTION grants.check_application_withdrawal();

GRANT SELECT,
      INSERT (tenant_id, application_id, outcome, amount_minor, currency, recorded_by,
              created_by, updated_by),
      UPDATE (outcome, amount_minor, currency, recorded_by, released_by, updated_by)
   ON grants.decision TO app_api;

-- A released decision's email to its applicant, once per decision, with
-- the template version fixed at release (ADR 0020). It starts pending;
-- each update records one sending attempt, sent or failed with a code and
-- no message text, and a sent email never changes. The trigger counts the
-- attempts and sets their times.
CREATE TABLE grants.decision_email (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL,
  recipient_person_id uuid NOT NULL,
  template_version_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_code text CHECK (error_code IN (
    'invalid_message', 'connection_failed', 'tls_failed', 'timeout', 'auth_failed', 'rejected',
    'recipient_refused', 'failed', 'no_address')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  CONSTRAINT decision_email_once UNIQUE (tenant_id, decision_id),
  CONSTRAINT decision_email_error CHECK ((status = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT decision_email_sent CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT decision_email_attempts CHECK (
    ((status = 'pending') = (attempts = 0)) AND ((attempts = 0) = (last_attempt_at IS NULL))),
  FOREIGN KEY (tenant_id, decision_id)
    REFERENCES grants.decision (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recipient_person_id)
    REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, template_version_id)
    REFERENCES grants.email_template_version (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.decision_email');
SELECT app.deny_command('grants.decision_email', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.decision_email
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- An email is written for a released decision only, to the application's
-- applicant, from a template version of the application's programme for
-- the decision's outcome. None of these ever changes once the decision is
-- released, so the check needs no lock. Like the checks in migration 0012,
-- it runs after the row-level security checks and foreign keys, and its
-- read runs under the caller's row-level security.
CREATE FUNCTION grants.check_decision_email()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM grants.decision d
    JOIN grants.application a ON a.tenant_id = d.tenant_id AND a.id = d.application_id
    JOIN grants.round r ON r.tenant_id = a.tenant_id AND r.id = a.round_id
    JOIN grants.email_template_version t
      ON t.tenant_id = d.tenant_id AND t.id = NEW.template_version_id
    WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.decision_id
      AND d.released_at IS NOT NULL
      AND a.applicant_person_id = NEW.recipient_person_id
      AND t.programme_id = r.programme_id AND t.outcome = d.outcome;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An email goes to the applicant of a released decision, from its programme''s template for its outcome.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER check_decision_email AFTER INSERT ON grants.decision_email
  FOR EACH ROW EXECUTE FUNCTION grants.check_decision_email();

-- Each update is one attempt: to sent, or to failed again or for the first
-- time. A sent email never changes, and none goes back to pending.
CREATE FUNCTION grants.record_decision_email_attempt()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.status = 'sent' THEN
    RAISE EXCEPTION 'A sent email never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.status = 'pending' THEN
    RAISE EXCEPTION 'An attempt to send an email ends sent or failed.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.attempts := OLD.attempts + 1;
  NEW.last_attempt_at := pg_catalog.now();
  IF NEW.status = 'sent' THEN
    NEW.sent_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER record_decision_email_attempt BEFORE UPDATE ON grants.decision_email
  FOR EACH ROW EXECUTE FUNCTION grants.record_decision_email_attempt();

GRANT SELECT,
      INSERT (tenant_id, decision_id, recipient_person_id, template_version_id, created_by,
              updated_by),
      UPDATE (status, error_code, updated_by)
   ON grants.decision_email TO app_api;

-- The tenant's 360Giving publisher details, one row per tenant: its own
-- org-id.guide identifier (scheme, then the register's identifier, such as
-- GB-CHC-1234567), its name as published, and the prefix 360Giving gave it
-- for grant identifiers.
CREATE TABLE grants.publisher_setting (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_identifier text NOT NULL CHECK (
    char_length(funder_identifier) <= 100
    AND funder_identifier ~ '^[A-Z]{2}-[A-Z0-9]+-[A-Za-z0-9()-]+$'),
  funder_name text NOT NULL CHECK (char_length(funder_name) BETWEEN 1 AND 200)
    CONSTRAINT publisher_setting_funder_name_text CHECK (funder_name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  identifier_prefix text NOT NULL CHECK (
    char_length(identifier_prefix) <= 50 AND identifier_prefix ~ '^360G-[A-Za-z0-9-]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  CONSTRAINT publisher_setting_once UNIQUE (tenant_id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.publisher_setting');
SELECT app.deny_command('grants.publisher_setting', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.publisher_setting
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, funder_identifier, funder_name, identifier_prefix, created_by,
              updated_by),
      UPDATE (funder_identifier, funder_name, identifier_prefix, updated_by)
   ON grants.publisher_setting TO app_api;
