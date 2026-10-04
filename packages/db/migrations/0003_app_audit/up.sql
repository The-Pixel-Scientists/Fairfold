-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0003, up: the tenant audit log and its retention setting
-- (architecture rule 4, ADR 0003 "Audit retention").
--
-- app.audit_event is append-only. app_api may insert and read; no role has a
-- permissive UPDATE or DELETE policy, and the app roles also meet a
-- restrictive false one. A trigger sets occurred_at and retain_until, so
-- neither is in any INSERT grant. Nothing deletes in MVP1: the retention
-- purge comes later as an approved definer function.

-- A tenant's retention settings. No row means the platform minimum. Nothing
-- writes it in MVP1; app_api may read it, and so may the audit trigger,
-- which runs with the inserting role's rights.
CREATE TABLE app.retention_policy (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy text NOT NULL CHECK (policy IN ('audit')),
  days integer NOT NULL CHECK (days BETWEEN 1 AND 36500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, policy),
  CONSTRAINT retention_policy_audit_minimum CHECK (policy <> 'audit' OR days >= 365),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.retention_policy');
SELECT app.deny_command('app.retention_policy', 'INSERT');
SELECT app.deny_command('app.retention_policy', 'UPDATE');
SELECT app.deny_command('app.retention_policy', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.retention_policy
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.retention_policy TO app_api;

-- One event per state change, decision, permission change or sensitive
-- read. The action is <module>.<entity>.<event>, and entity_type is its
-- first two parts. actor_id is the acting membership, set exactly when a
-- user acted. changes holds field ids, with values only for public and
-- internal fields (D12); the writer in apps/api/src/audit decides which.
CREATE TABLE app.audit_event (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL,
  request_id uuid NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'system', 'operator')),
  actor_id uuid,
  action text NOT NULL CHECK (action ~ '^[a-z]+\.[a-z][a-z_]*\.[a-z][a-z_]*$'),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'object'),
  UNIQUE (tenant_id, id),
  CONSTRAINT audit_event_actor CHECK ((actor_kind = 'user') = (actor_id IS NOT NULL)),
  CONSTRAINT audit_event_entity_type CHECK (
    entity_type = split_part(action, '.', 1) || '.' || split_part(action, '.', 2)),
  -- The platform minimum of 12 months, counted in UTC so the session's time
  -- zone cannot move it.
  CONSTRAINT audit_event_retention_floor CHECK (
    retain_until >= ((occurred_at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC'),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);

-- A tenant's copy of an auth event is written once, however often it is
-- retried (ADR 0010): its entity id is the auth event's id.
CREATE UNIQUE INDEX audit_event_auth_copy_once ON app.audit_event (tenant_id, entity_id)
  WHERE entity_type = 'platform.auth';

-- The standard SELECT and INSERT policies, written out because
-- app.enable_tenant_rls() would also add permissive UPDATE and DELETE ones.
ALTER TABLE app.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON app.audit_event AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_insert ON app.audit_event AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (tenant_id = app.current_tenant_id());
SELECT app.deny_command('app.audit_event', 'UPDATE');
SELECT app.deny_command('app.audit_event', 'DELETE');

-- Set occurred_at to now and retain_until from the tenant's audit rule,
-- never below 12 months, whatever the insert supplied. It runs with the
-- inserting role's rights, so it sees the retention row of the current
-- tenant only; an insert for another tenant fails its policy anyway.
CREATE FUNCTION app.set_audit_retention()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  audit_days integer;
  occurred timestamp;
BEGIN
  SELECT p.days INTO audit_days
    FROM app.retention_policy p
   WHERE p.tenant_id = NEW.tenant_id AND p.policy = 'audit';
  NEW.occurred_at := pg_catalog.now();
  occurred := NEW.occurred_at AT TIME ZONE 'UTC';
  NEW.retain_until := (GREATEST(
    occurred + interval '12 months',
    occurred + pg_catalog.make_interval(days => COALESCE(audit_days, 0))
  )) AT TIME ZONE 'UTC';
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_audit_retention BEFORE INSERT ON app.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.set_audit_retention();

GRANT SELECT,
      INSERT (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id, changes)
   ON app.audit_event TO app_api;
