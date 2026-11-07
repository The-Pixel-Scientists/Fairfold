-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0022, up: device cookies for sign-in limits (ADR 0010, "Sign-in
-- limits and passwords"; S11-46).
--
-- A browser that completed a sign-in holds a signed cookie naming a random
-- device id. Its password failures then count per identifier and device
-- alone, so failures from other clients never delay it. An account spans
-- tenants, so a device has no tenant and is on ADR 0003's allowlist like
-- the rest of the auth schema: only app_auth holds grants, and row-level
-- security is enabled and forced.

-- The device id is kept only as its SHA-256 hash, as session tokens are: it
-- is at least 128 random bits, so a keyed hash adds nothing, and a hash
-- presented as a cookie's id matches nothing. The cookie records the key
-- version that signed it, and so does its row. Ids, issued_at, created_at
-- and updated_at come from the database.
CREATE TABLE auth.device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth."user" (id) ON DELETE CASCADE,
  device_hash bytea NOT NULL UNIQUE CHECK (octet_length(device_hash) = 32),
  key_version smallint NOT NULL CHECK (key_version >= 1),
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_last_used CHECK (last_used_at >= issued_at),
  CONSTRAINT device_revoked CHECK (revoked_at >= issued_at)
);
CREATE INDEX device_user ON auth.device (user_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON auth.device
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE auth.device ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.device FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_select ON auth.device FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth.device FOR INSERT TO app_auth, migrator WITH CHECK (true);
-- A revoked device stays revoked: no update reaches its row.
CREATE POLICY auth_update ON auth.device FOR UPDATE TO app_auth, migrator
  USING (revoked_at IS NULL) WITH CHECK (true);
-- The purge removes a device 12 months after issue or 30 days after
-- revocation, whichever is first, and nothing sooner.
CREATE POLICY auth_delete ON auth.device FOR DELETE TO app_auth, migrator
  USING (issued_at <= now() - interval '12 months' OR revoked_at <= now() - interval '30 days');
GRANT SELECT, DELETE, INSERT (user_id, device_hash, key_version), UPDATE (last_used_at, revoked_at)
   ON auth.device TO app_auth;

-- A sign-in counter per identifier and device. Its row goes with its device.
ALTER TABLE auth.rate_limit
  ADD COLUMN device_id uuid REFERENCES auth.device (id) ON DELETE CASCADE,
  DROP CONSTRAINT rate_limit_scope_check,
  ADD CONSTRAINT rate_limit_scope_check CHECK (scope IN (
    'sign_in_identifier_ip', 'sign_in_identifier', 'sign_in_ip', 'sign_in_identifier_device',
    'email_identifier', 'email_ip')),
  DROP CONSTRAINT rate_limit_identifier,
  ADD CONSTRAINT rate_limit_identifier CHECK ((identifier IS NOT NULL) = (scope IN (
    'sign_in_identifier_ip', 'sign_in_identifier', 'sign_in_identifier_device',
    'email_identifier'))),
  ADD CONSTRAINT rate_limit_device CHECK (
    (device_id IS NOT NULL) = (scope = 'sign_in_identifier_device')),
  DROP CONSTRAINT rate_limit_scope_identifier_client_ip_key,
  ADD CONSTRAINT rate_limit_key UNIQUE NULLS NOT DISTINCT (scope, identifier, client_ip, device_id);
CREATE INDEX rate_limit_device ON auth.rate_limit (device_id) WHERE device_id IS NOT NULL;
GRANT INSERT (device_id) ON auth.rate_limit TO app_auth;
