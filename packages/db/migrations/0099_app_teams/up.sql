-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0099, up: teams, team members, break-glass grants and the
-- member setting (ADR 0037, S12-70).
--
-- A team is a list of members that a restricted record's access rows can
-- name; it grants no permission. Teams are archived and members removed by
-- the columns below, never deleted, so membership history stays. A
-- break-glass grant opens one restricted record for one hour. It is
-- append-only, and no app role may insert one: S12-79's approved open
-- function does, as its own owner. Its times and retention are set by the
-- database, ignoring anything supplied. The reason codes copy
-- packages/domain/src/platform/team/break-glass.ts, and a test keeps the two
-- in step. Every foreign key carries tenant_id, so a row can never name
-- another tenant's member, team or grant.

-- The membership of the current transaction, or NULL when none is set or no
-- tenant is. withTenant() alone sets app.membership_id, transaction-locally
-- and only to an active membership of the tenant. No app role may call this:
-- the reach functions S12-79 and the modules add call it as their owners.
CREATE FUNCTION app.current_membership_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
  SECURITY INVOKER
  RETURN CASE WHEN app.current_tenant_id() IS NOT NULL
    THEN NULLIF(pg_catalog.current_setting('app.membership_id', true), '')::uuid END;

CREATE TABLE app.team (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
    CONSTRAINT team_name_length CHECK (char_length(name) BETWEEN 1 AND 100)
    CONSTRAINT team_name_text CHECK (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT team_archived CHECK ((archived_at IS NULL) = (archived_by IS NULL)),
  FOREIGN KEY (tenant_id, archived_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX team_name_unique ON app.team (tenant_id, lower(name))
  WHERE archived_at IS NULL;
SELECT app.enable_tenant_rls('app.team');
SELECT app.deny_command('app.team', 'DELETE');

-- One row per spell in a team: a member removed and added again gets a new
-- row, and at most one row per team and member is current.
CREATE TABLE app.team_member (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  removed_at timestamptz,
  removed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT team_member_removed CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  FOREIGN KEY (tenant_id, team_id) REFERENCES app.team (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, removed_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX team_member_current ON app.team_member (tenant_id, team_id, membership_id)
  WHERE removed_at IS NULL;
CREATE INDEX team_member_membership ON app.team_member (tenant_id, membership_id)
  WHERE removed_at IS NULL;
SELECT app.enable_tenant_rls('app.team_member');
SELECT app.deny_command('app.team_member', 'DELETE');

-- Archiving a team and removing a member are final, and the database sets
-- when they happened: the app roles may write only who did it.
CREATE FUNCTION app.keep_team_archive()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.archived_by IS NOT NULL THEN
    RAISE EXCEPTION 'An archived team cannot be changed.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.archived_by IS NOT NULL THEN
    NEW.archived_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_team_archive BEFORE UPDATE ON app.team
  FOR EACH ROW EXECUTE FUNCTION app.keep_team_archive();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.team
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE FUNCTION app.keep_team_member_removal()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.removed_by IS NOT NULL THEN
    RAISE EXCEPTION 'A removed team member cannot be changed.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.removed_by IS NOT NULL THEN
    NEW.removed_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_team_member_removal BEFORE UPDATE ON app.team_member
  FOR EACH ROW EXECUTE FUNCTION app.keep_team_member_removal();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.team_member
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- A break-glass grant: the member, the record (its type and id, which a
-- module's access row ties to its own record through the five-column key),
-- the reason code and the reason text, sealed under the member's subject key
-- (ADR 0027: a 12-byte nonce, the text of 20 to 1,000 characters as at most
-- 3,000 bytes of UTF-8, and a 16-byte tag). The id comes from the API, which
-- seals the text with it as associated data; a duplicate fails the primary
-- key. granted_at and membership_id record when and by whom; the row never
-- changes, so it has no updated columns.
CREATE TABLE app.break_glass (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY,
  membership_id uuid NOT NULL,
  record_type text NOT NULL CHECK (record_type ~ '^[a-z]+\.[a-z][a-z_]*$'),
  record_id uuid NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN (
    'risk_to_life', 'safeguarding_concern', 'legal_duty', 'named_people_unavailable', 'other')),
  reason_text_ciphertext bytea NOT NULL
    CHECK (octet_length(reason_text_ciphertext) BETWEEN 48 AND 3028),
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  retain_until timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, membership_id, record_type, record_id),
  CONSTRAINT break_glass_one_hour CHECK (expires_at = granted_at + interval '1 hour'),
  CONSTRAINT break_glass_retention_floor CHECK (
    retain_until >= ((granted_at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC'),
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX break_glass_membership ON app.break_glass (tenant_id, membership_id, expires_at);

-- 0003's append-only pattern: SELECT and INSERT tenant policies only, and a
-- restrictive false policy for every app role on each command none may run.
ALTER TABLE app.break_glass ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.break_glass FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON app.break_glass AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_insert ON app.break_glass AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (tenant_id = app.current_tenant_id());
SELECT app.deny_command('app.break_glass', 'INSERT');
SELECT app.deny_command('app.break_glass', 'UPDATE');
SELECT app.deny_command('app.break_glass', 'DELETE');

-- Set granted_at to now, expires_at one hour later and retain_until from the
-- tenant's audit rule, never below 12 months, whatever the insert supplied,
-- as app.set_audit_retention() does for audit events. It runs with the
-- inserting role's rights.
CREATE FUNCTION app.set_break_glass_times()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  audit_days integer;
  granted timestamp;
BEGIN
  SELECT p.days INTO audit_days
    FROM app.retention_policy p
   WHERE p.tenant_id = NEW.tenant_id AND p.policy = 'audit';
  NEW.granted_at := pg_catalog.now();
  NEW.expires_at := NEW.granted_at + interval '1 hour';
  granted := NEW.granted_at AT TIME ZONE 'UTC';
  NEW.retain_until := (GREATEST(
    granted + interval '12 months',
    granted + pg_catalog.make_interval(days => COALESCE(audit_days, 0))
  )) AT TIME ZONE 'UTC';
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_break_glass_times BEFORE INSERT ON app.break_glass
  FOR EACH ROW EXECUTE FUNCTION app.set_break_glass_times();

GRANT SELECT,
      INSERT (tenant_id, name, created_by, updated_by),
      UPDATE (name, archived_by, updated_by)
   ON app.team TO app_api;
GRANT SELECT,
      INSERT (tenant_id, team_id, membership_id, created_by, updated_by),
      UPDATE (removed_by, updated_by)
   ON app.team_member TO app_api;
GRANT SELECT ON app.break_glass TO app_api;
