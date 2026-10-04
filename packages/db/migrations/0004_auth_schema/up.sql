-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0004, up: the auth schema for the first release's sign-in
-- (ADR 0007, ADR 0010, D2), and auth.session_context(), the one way the
-- other app roles learn about a session (ADR 0003).
--
-- Accounts span tenants, so no table here is a tenant table; each is on ADR
-- 0003's allowlist. Row-level security is still enabled and forced: app_auth
-- and migrator reach rows only through the policies that name them, the
-- function owner through one SELECT policy on each table it reads, and every
-- command that no app role may run meets a restrictive false policy. Of the
-- app roles, only app_auth holds grants on the tables. Ids, created_at and
-- updated_at come from the database. Tables follow Better Auth 1.7's core
-- and two-factor models in snake case, for credential accounts only; SSO and
-- passkeys add theirs later, and the user's image comes with SSO.

CREATE SCHEMA auth AUTHORIZATION migrator;
GRANT USAGE ON SCHEMA auth TO app_auth;
-- Only to call auth.session_context(); app_api holds nothing else here.
GRANT USAGE ON SCHEMA auth TO app_api;

-- One row per person. Deactivating an account is an operator runbook, so
-- app_auth cannot change status.
CREATE TABLE auth."user" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 200),
  email text NOT NULL UNIQUE CHECK (
    email = lower(btrim(email)) AND char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  email_verified boolean NOT NULL DEFAULT false,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A signed-in browser in one app. The token is kept only as its SHA-256
-- hash. A new MFA state or active tenant means a new session (ADR 0010), so
-- neither can be updated.
CREATE TABLE auth.session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth."user" (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  app text NOT NULL CHECK (app IN ('console', 'portal')),
  active_tenant_id uuid REFERENCES app.tenant (id) ON DELETE RESTRICT,
  mfa_state text NOT NULL CHECK (mfa_state IN ('enrol', 'verify', 'complete', 'not_required')),
  mfa_failures smallint NOT NULL DEFAULT 0 CHECK (mfa_failures BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  reauthenticated_at timestamptz,
  revoked_at timestamptz,
  ip_address inet,
  user_agent text CHECK (char_length(user_agent) <= 1024),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Staff MFA is mandatory, so a console session is never "not required".
  CONSTRAINT session_console_mfa CHECK (app = 'portal' OR mfa_state <> 'not_required'),
  CONSTRAINT session_times CHECK (
    expires_at > created_at AND last_seen_at >= created_at AND revoked_at >= created_at)
);
CREATE INDEX session_user_id ON auth.session (user_id);

-- A credential (password) account. account_id is the user's id, as Better
-- Auth sets it, and the password is an Argon2id hash in PHC form.
CREATE TABLE auth.account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth."user" (id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL CHECK (provider_id = 'credential'),
  password text NOT NULL CHECK (
    password ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{32,}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider_id),
  UNIQUE (provider_id, account_id),
  CONSTRAINT account_credential_id CHECK (account_id = user_id::text)
);

-- Single-use values for emailed links. The identifier is stored hashed
-- (storeIdentifier "hashed": SHA-256 in unpadded base64url), so it can hold
-- neither an address nor a raw token.
CREATE TABLE auth.verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL CHECK (identifier ~ '^[A-Za-z0-9_-]{43}$'),
  value text NOT NULL CHECK (char_length(value) <= 2048),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX verification_identifier ON auth.verification (identifier);

-- A user's TOTP secret as Better Auth encrypts it: hex of nonce, ciphertext
-- and tag, in a "$ba$<key version>$" envelope once secrets are versioned,
-- so never base32 in clear. verified is false until the first code is
-- confirmed. last_used_step is the last time step accepted, so each code
-- works once. Backup codes are deferred (D2), and ADR 0010 has no lockout,
-- so those columns keep their empty values and no role may write them.
CREATE TABLE auth.two_factor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth."user" (id) ON DELETE CASCADE,
  secret text NOT NULL CHECK (
    char_length(secret) <= 2048 AND secret ~ '^(\$ba\$[0-9]{1,9}\$)?[0-9a-f]{80,}$'),
  verified boolean NOT NULL DEFAULT false,
  backup_codes text CHECK (backup_codes IS NULL),
  failed_verification_count integer NOT NULL DEFAULT 0 CHECK (failed_verification_count = 0),
  locked_until timestamptz CHECK (locked_until IS NULL),
  last_used_step bigint CHECK (last_used_step >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sign-in and email counters for D2's limits (ADR 0010), without device
-- cookies. The identifier is normalised, or an HMAC of it in lower-case hex.
-- A client IP is an IPv4 address or an IPv6 /64, so one /64 counts as one
-- address; cidr refuses host bits, so callers store the network.
CREATE TABLE auth.rate_limit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN (
    'sign_in_identifier_ip', 'sign_in_identifier', 'sign_in_ip', 'email_identifier', 'email_ip')),
  identifier text CHECK (identifier = lower(btrim(identifier)) AND char_length(identifier) BETWEEN 1 AND 320),
  client_ip cidr CHECK (
    (family(client_ip) = 4 AND masklen(client_ip) = 32)
    OR (family(client_ip) = 6 AND masklen(client_ip) = 64)),
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_identifier CHECK ((identifier IS NOT NULL) = (scope IN (
    'sign_in_identifier_ip', 'sign_in_identifier', 'email_identifier'))),
  CONSTRAINT rate_limit_client_ip CHECK ((client_ip IS NOT NULL) = (scope IN (
    'sign_in_identifier_ip', 'sign_in_ip', 'email_ip'))),
  UNIQUE NULLS NOT DISTINCT (scope, identifier, client_ip)
);

-- Auth events (ADR 0010), append-only for app_auth and kept exactly 12
-- months. The codes copy authEventCodes in packages/domain/src/auth, and a
-- test keeps the two in step. No passwords, codes or tokens, ever.
CREATE TABLE auth.audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL,
  request_id uuid NOT NULL,
  code text NOT NULL CHECK (code IN (
    'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
    'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
    'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
    'sessions_revoked', 'invitation_accepted')),
  reason text CHECK (reason ~ '^[a-z][a-z_]{0,62}$'),
  user_id uuid REFERENCES auth."user" (id) ON DELETE RESTRICT,
  tenant_id uuid REFERENCES app.tenant (id) ON DELETE RESTRICT,
  identifier text CHECK (char_length(identifier) BETWEEN 1 AND 320),
  ip_address inet,
  CONSTRAINT audit_event_retention CHECK (
    retain_until = ((occurred_at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC')
);

-- Set occurred_at and retain_until, whatever the insert supplied.
CREATE FUNCTION auth.set_audit_retention()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.occurred_at := pg_catalog.now();
  NEW.retain_until := ((NEW.occurred_at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC';
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_audit_retention BEFORE INSERT ON auth.audit_event
  FOR EACH ROW EXECUTE FUNCTION auth.set_audit_retention();

-- An auth event still to be copied to its tenant's audit log (ADR 0010).
CREATE TABLE auth.audit_copy_pending (
  auth_event_id uuid PRIMARY KEY REFERENCES auth.audit_event (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON auth."user"
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON auth.session
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON auth.account
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON auth.verification
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON auth.two_factor
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON auth.rate_limit
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE auth."user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth."user" FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.session FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.account ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.account FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.verification FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.two_factor ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.two_factor FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.rate_limit FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.audit_event FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.audit_copy_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.audit_copy_pending FORCE ROW LEVEL SECURITY;

-- These policies match every row for app_auth, whose grants decide what it
-- may do, and for migrator, the tables' owner. With FORCE and no policy of
-- its own, a data migration on these global tables would silently change
-- nothing. No policy names migrator for a command that app_auth lacks, so the
-- audit tables stay insert-and-select for it too.
CREATE POLICY auth_select ON auth."user" FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth."user" FOR INSERT TO app_auth, migrator WITH CHECK (true);
CREATE POLICY auth_update ON auth."user" FOR UPDATE TO app_auth, migrator USING (true) WITH CHECK (true);
SELECT app.deny_command('auth.user', 'DELETE');
GRANT SELECT, INSERT (name, email, email_verified, two_factor_enabled),
      UPDATE (name, two_factor_enabled)
   ON auth."user" TO app_auth;

CREATE POLICY auth_select ON auth.session FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth.session FOR INSERT TO app_auth, migrator WITH CHECK (true);
CREATE POLICY auth_update ON auth.session FOR UPDATE TO app_auth, migrator USING (true) WITH CHECK (true);
CREATE POLICY auth_delete ON auth.session FOR DELETE TO app_auth, migrator USING (true);
GRANT SELECT, DELETE,
      INSERT (user_id, token_hash, app, active_tenant_id, mfa_state, expires_at,
              reauthenticated_at, ip_address, user_agent),
      UPDATE (mfa_failures, expires_at, last_seen_at, reauthenticated_at, revoked_at)
   ON auth.session TO app_auth;

CREATE POLICY auth_select ON auth.account FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth.account FOR INSERT TO app_auth, migrator WITH CHECK (true);
CREATE POLICY auth_update ON auth.account FOR UPDATE TO app_auth, migrator USING (true) WITH CHECK (true);
SELECT app.deny_command('auth.account', 'DELETE');
GRANT SELECT, INSERT (user_id, account_id, provider_id, password), UPDATE (password)
   ON auth.account TO app_auth;

CREATE POLICY auth_select ON auth.verification FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth.verification FOR INSERT TO app_auth, migrator WITH CHECK (true);
CREATE POLICY auth_delete ON auth.verification FOR DELETE TO app_auth, migrator USING (true);
SELECT app.deny_command('auth.verification', 'UPDATE');
GRANT SELECT, DELETE, INSERT (identifier, value, expires_at) ON auth.verification TO app_auth;

CREATE POLICY auth_select ON auth.two_factor FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth.two_factor FOR INSERT TO app_auth, migrator WITH CHECK (true);
CREATE POLICY auth_update ON auth.two_factor FOR UPDATE TO app_auth, migrator USING (true) WITH CHECK (true);
SELECT app.deny_command('auth.two_factor', 'DELETE');
GRANT SELECT, INSERT (user_id, secret, verified), UPDATE (secret, verified, last_used_step)
   ON auth.two_factor TO app_auth;

CREATE POLICY auth_select ON auth.rate_limit FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth.rate_limit FOR INSERT TO app_auth, migrator WITH CHECK (true);
CREATE POLICY auth_update ON auth.rate_limit FOR UPDATE TO app_auth, migrator USING (true) WITH CHECK (true);
CREATE POLICY auth_delete ON auth.rate_limit FOR DELETE TO app_auth, migrator USING (true);
GRANT SELECT, DELETE,
      INSERT (scope, identifier, client_ip, count, window_started_at, blocked_until),
      UPDATE (count, window_started_at, blocked_until)
   ON auth.rate_limit TO app_auth;

CREATE POLICY auth_select ON auth.audit_event FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth.audit_event FOR INSERT TO app_auth, migrator WITH CHECK (true);
SELECT app.deny_command('auth.audit_event', 'UPDATE');
SELECT app.deny_command('auth.audit_event', 'DELETE');
GRANT SELECT,
      INSERT (request_id, code, reason, user_id, tenant_id, identifier, ip_address)
   ON auth.audit_event TO app_auth;

CREATE POLICY auth_select ON auth.audit_copy_pending FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth.audit_copy_pending FOR INSERT TO app_auth, migrator WITH CHECK (true);
CREATE POLICY auth_delete ON auth.audit_copy_pending FOR DELETE TO app_auth, migrator USING (true);
SELECT app.deny_command('auth.audit_copy_pending', 'UPDATE');
GRANT SELECT, DELETE, INSERT (auth_event_id) ON auth.audit_copy_pending TO app_auth;

-- Every membership belongs to an account. Adding the key checks existing
-- rows as migrator under forced row-level security with no tenant set, so it
-- sees none of them: it proves nothing about memberships made before this
-- migration. No account existed before it, so any such membership is test
-- or seed data; recreate those databases rather than migrate them.
ALTER TABLE app.membership ADD CONSTRAINT membership_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth."user" (id) ON DELETE RESTRICT;

-- The live session whose token hashes to token_hash: not revoked, its user
-- active, inside its app's idle and absolute timeouts and Better Auth's
-- expiry, and, while waiting for MFA, at most 10 minutes old (ADR 0010).
-- expires_at is when it ends unless used. No row for any other hash. The
-- body is parsed here, so every name is fixed now, and the timeouts join by
-- app, so an unknown app matches nothing.
CREATE FUNCTION auth.session_context(token_hash bytea)
  RETURNS TABLE (
    user_id uuid,
    active_tenant_id uuid,
    app text,
    mfa_state text,
    expires_at timestamptz,
    reauthenticated_at timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT s.user_id, s.active_tenant_id, s.app, s.mfa_state, e.ends_at, s.reauthenticated_at
    FROM auth.session AS s
    JOIN auth."user" AS u ON u.id = s.user_id
    JOIN (VALUES ('console', interval '30 minutes', interval '12 hours'),
                 ('portal', interval '60 minutes', interval '24 hours'))
      AS t (app, idle, absolute) ON t.app = s.app
   CROSS JOIN LATERAL (SELECT LEAST(
       s.expires_at, s.created_at + t.absolute, s.last_seen_at + t.idle,
       CASE WHEN s.mfa_state IN ('enrol', 'verify') THEN s.created_at + interval '10 minutes' END)
     AS ends_at) AS e
   WHERE s.token_hash = session_context.token_hash
     AND s.revoked_at IS NULL
     AND u.status = 'active'
     AND e.ends_at > pg_catalog.now();
END;

-- Its owner reads only these columns, through one policy on each table.
GRANT USAGE ON SCHEMA auth TO owner_auth_session_context;
GRANT SELECT (token_hash, user_id, active_tenant_id, app, mfa_state, expires_at, created_at,
              last_seen_at, reauthenticated_at, revoked_at)
   ON auth.session TO owner_auth_session_context;
GRANT SELECT (id, status) ON auth."user" TO owner_auth_session_context;
CREATE POLICY session_context_select ON auth.session FOR SELECT
  TO owner_auth_session_context USING (true);
CREATE POLICY session_context_select ON auth."user" FOR SELECT
  TO owner_auth_session_context USING (true);

-- Hand the function to its owner (ADR 0023): grants first, CREATE only for
-- the handover.
REVOKE ALL ON FUNCTION auth.session_context(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.session_context(bytea) TO app_api;
GRANT CREATE ON SCHEMA auth TO owner_auth_session_context;
ALTER FUNCTION auth.session_context(bytea) OWNER TO owner_auth_session_context;
REVOKE CREATE ON SCHEMA auth FROM owner_auth_session_context;
