-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0030, up: passkeys (ADR 0007, ADR 0010, "Data and roles";
-- S11-83).
--
-- auth.passkey follows the passkey plugin's model (Better Auth 1.7) in
-- snake case. A passkey belongs to an account, which spans tenants, so it
-- has no tenant and is on ADR 0003's allowlist like the rest of the auth
-- schema: row-level security is enabled and forced, its policies name only
-- app_auth and migrator, and only app_auth holds grants. Every passkey was
-- registered with user verification, so each counts as a factor. Ids,
-- created_at and updated_at come from the database; app_auth may later
-- change only the signature counter, the time of last use and the name.
-- The event check widens to the two passkey events, keeping its name, so
-- every existing row still passes. The list copies authEventCodes in
-- packages/domain/src/auth, and rights.test.ts reads it back.

CREATE TABLE auth.passkey (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth."user" (id) ON DELETE CASCADE,
  -- Unpadded base64url, as WebAuthn gives it: at most 1,023 bytes.
  credential_id text NOT NULL UNIQUE CHECK (
    char_length(credential_id) <= 1366 AND credential_id ~ '^[A-Za-z0-9_-]+$'),
  -- The COSE public key in base64. Never a secret, never shown.
  public_key text NOT NULL CHECK (
    char_length(public_key) <= 2048 AND public_key ~ '^[A-Za-z0-9+/]+={0,2}$'),
  -- The authenticator's signature counter, an unsigned 32-bit number.
  counter bigint NOT NULL CHECK (counter BETWEEN 0 AND 4294967295),
  -- The user's own words, as the contract bounds them.
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64 AND name !~ '[[:cntrl:]]'),
  device_type text NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up boolean NOT NULL,
  -- The transports the browser named, comma-separated.
  transports text CHECK (transports ~ '^([a-z-]{1,16}(,[a-z-]{1,16}){0,7})?$'),
  aaguid uuid,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Only a passkey that may be backed up (multi-device) can be.
  CONSTRAINT passkey_backed_up CHECK (NOT backed_up OR device_type = 'multiDevice'),
  CONSTRAINT passkey_last_used CHECK (last_used_at >= created_at)
);
CREATE INDEX passkey_user ON auth.passkey (user_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON auth.passkey
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE auth.passkey ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.passkey FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_select ON auth.passkey FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth.passkey FOR INSERT TO app_auth, migrator WITH CHECK (true);
CREATE POLICY auth_update ON auth.passkey FOR UPDATE TO app_auth, migrator
  USING (true) WITH CHECK (true);
CREATE POLICY auth_delete ON auth.passkey FOR DELETE TO app_auth, migrator USING (true);
GRANT SELECT, DELETE,
      INSERT (user_id, credential_id, public_key, counter, name, device_type, backed_up,
              transports, aaguid),
      UPDATE (counter, last_used_at, name)
   ON auth.passkey TO app_auth;

ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
  'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
  'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
  'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
  'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
  'backup_code_used', 'backup_codes_regenerated', 'email_changed', 'passkey_added',
  'passkey_removed'));
