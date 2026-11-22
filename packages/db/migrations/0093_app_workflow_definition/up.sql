-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0093, up: stored workflow definitions and the session actor that
-- every approval trigger checks (S12-69, ADR 0038).
--
-- app.workflow_definition holds one row per definition key in a tenant, and
-- app.workflow_definition_version its numbered versions, each the whole
-- document the server has checked against the module's shipped definition
-- (packages/domain/src/workflow). The key pattern copies workflowKeySchema.
-- Both are append-only for every app role and kept for the life of the
-- tenant, since requests pin versions (rule 7). The server writes the
-- matching app.config_version row, entity type platform.workflow_definition
-- (rule 10). Neither table holds a tenant's free text or a member's value.
--
-- app.session_actor() is the membership acting in this transaction as the
-- verified session proves it: the live console session whose token hash, in
-- hex, the transaction-local setting app.session_token_hash names, past MFA,
-- active in the current tenant, whose user has an active membership there.
-- It returns no row otherwise, and every approval trigger then refuses. It
-- runs as the caller and reads auth.session only through
-- auth.session_context(), so no app role can learn another session's hash.

CREATE FUNCTION app.session_actor()
  RETURNS TABLE (membership_id uuid, reauthenticated_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT m.id, s.reauthenticated_at
    FROM auth.session_context(pg_catalog.decode(
           pg_catalog.current_setting('app.session_token_hash', true), 'hex')) AS s
    JOIN app.membership AS m ON m.tenant_id = s.active_tenant_id AND m.user_id = s.user_id
   WHERE s.app = 'console' AND s.mfa_state = 'complete'
     AND s.active_tenant_id = app.current_tenant_id() AND m.status = 'active';
END;
GRANT EXECUTE ON FUNCTION app.session_actor() TO app_api;

CREATE TABLE app.workflow_definition (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL
    CONSTRAINT workflow_definition_key_format CHECK (key ~ '^[a-z]+\.[a-z][a-z_]{0,62}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, key),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.workflow_definition');
SELECT app.deny_command('app.workflow_definition', 'UPDATE');
SELECT app.deny_command('app.workflow_definition', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON app.workflow_definition
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
GRANT SELECT, INSERT (tenant_id, key, created_by) ON app.workflow_definition TO app_api;

-- The request trigger reads approvalSteps from the pinned document, so the
-- check keeps it an array and the document's version this row's.
CREATE TABLE app.workflow_definition_version (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL,
  version integer NOT NULL CONSTRAINT workflow_definition_version_number CHECK (version >= 1),
  document jsonb NOT NULL CONSTRAINT workflow_definition_version_document CHECK (
    jsonb_typeof(document) = 'object' AND document -> 'version' = to_jsonb(version)
    AND jsonb_typeof(document -> 'approvalSteps') = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, definition_id, version),
  FOREIGN KEY (tenant_id, definition_id)
    REFERENCES app.workflow_definition (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.workflow_definition_version');
SELECT app.deny_command('app.workflow_definition_version', 'UPDATE');
SELECT app.deny_command('app.workflow_definition_version', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON app.workflow_definition_version
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
GRANT SELECT, INSERT (tenant_id, definition_id, version, document, created_by)
   ON app.workflow_definition_version TO app_api;

-- The author of a definition or a version must be app.session_actor()'s
-- membership, and a version after the first, which changes counts, needs a
-- step-up in the last 5 minutes (ADR 0010), as its route does. Versions
-- follow one another with no gap. Each step needs 1 to 5 approvers
-- (MAX_APPROVERS in packages/domain/src/workflow), and a later version
-- keeps the previous version's steps, in order, with no fewer approvers.
-- Everything else in a later version must match the previous one, except
-- each step's approvers, remindAfterDays and dueAfterDays, as fixedParts in
-- packages/domain/src/workflow/definition.ts allows. So a direct query can
-- tighten a control but never weaken or remove one; the server still checks
-- each document, the first included, against the shipped definition.
CREATE FUNCTION app.check_workflow_definition()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (SELECT FROM app.session_actor() a WHERE a.membership_id = NEW.created_by) THEN
    RAISE EXCEPTION 'Only the member of this session can add a workflow definition.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'workflow_definition_actor';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_workflow_definition BEFORE INSERT ON app.workflow_definition
  FOR EACH ROW EXECUTE FUNCTION app.check_workflow_definition();

CREATE FUNCTION app.check_workflow_definition_version()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  actor record;
  previous app.workflow_definition_version;
BEGIN
  SELECT a.reauthenticated_at INTO actor FROM app.session_actor() a
   WHERE a.membership_id = NEW.created_by;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the member of this session can add a workflow definition version.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'workflow_definition_version_actor';
  END IF;
  IF NEW.version > 1
     AND (actor.reauthenticated_at >= pg_catalog.now() - interval '5 minutes') IS NOT TRUE THEN
    RAISE EXCEPTION 'A new version needs the member to have signed in again in the last 5 minutes.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'workflow_definition_version_step_up';
  END IF;
  SELECT v.* INTO previous FROM app.workflow_definition_version v
   WHERE v.tenant_id = NEW.tenant_id AND v.definition_id = NEW.definition_id
   ORDER BY v.version DESC
   LIMIT 1;
  IF NEW.version IS DISTINCT FROM COALESCE(previous.version, 0) + 1 THEN
    RAISE EXCEPTION 'A version must be the next after its definition''s latest version.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_definition_version_sequence';
  END IF;
  -- The document check refuses a document without a list of steps.
  IF pg_catalog.jsonb_typeof(NEW.document -> 'approvalSteps') IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.jsonb_array_elements(NEW.document -> 'approvalSteps') s
              WHERE (pg_catalog.jsonb_typeof(s -> 'approvers') = 'number'
                     AND s ->> 'approvers' IN ('1', '2', '3', '4', '5')) IS NOT TRUE) THEN
    RAISE EXCEPTION 'Each approval step needs 1 to 5 approvers.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_definition_version_approvers';
  END IF;
  IF NEW.version > 1 AND EXISTS (
       SELECT FROM pg_catalog.jsonb_array_elements(previous.document -> 'approvalSteps')
                     WITH ORDINALITY AS o (step, n)
       FULL JOIN pg_catalog.jsonb_array_elements(NEW.document -> 'approvalSteps')
                     WITH ORDINALITY AS s (step, n) USING (n)
       WHERE s.step -> 'id' IS DISTINCT FROM o.step -> 'id'
          OR (s.step ->> 'approvers')::integer < (o.step ->> 'approvers')::integer) THEN
    RAISE EXCEPTION 'A new version keeps every approval step, in order, with no fewer approvers.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_definition_version_weaker';
  END IF;
  IF NEW.version > 1 AND (
       (NEW.document - 'version' - 'approvalSteps')
         IS DISTINCT FROM (previous.document - 'version' - 'approvalSteps')
       OR (SELECT pg_catalog.jsonb_agg(s - 'approvers' - 'remindAfterDays' - 'dueAfterDays' ORDER BY n)
             FROM pg_catalog.jsonb_array_elements(NEW.document -> 'approvalSteps')
                    WITH ORDINALITY AS x (s, n))
         IS DISTINCT FROM
          (SELECT pg_catalog.jsonb_agg(s - 'approvers' - 'remindAfterDays' - 'dueAfterDays' ORDER BY n)
             FROM pg_catalog.jsonb_array_elements(previous.document -> 'approvalSteps')
                    WITH ORDINALITY AS x (s, n))) THEN
    RAISE EXCEPTION 'A new version can change only approver counts and reminder and due days.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workflow_definition_version_weaker';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_workflow_definition_version BEFORE INSERT ON app.workflow_definition_version
  FOR EACH ROW EXECUTE FUNCTION app.check_workflow_definition_version();
