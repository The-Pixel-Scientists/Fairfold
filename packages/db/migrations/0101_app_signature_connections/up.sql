-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0101, up: signature connections (ADR 0040, S12-62).
--
-- A connection is a tenant's account at a signature provider, written by an
-- operator command as app_operator: the adapter key, the provider's account
-- id, its API token sealed as ADR 0010 seals SSO secrets with its key
-- version, and the SHA-256 of the callback reference with its key version.
-- The reference itself is held only in the webhook address at the provider.
-- One active connection per tenant and provider, and a closed one stays
-- closed; nothing deletes one. app_api sees which connections exist;
-- app_worker reads the sealed token to call the provider; no app role reads
-- the reference's hash, which only migration 0105's function reads.

CREATE TABLE app.signature_connection (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{0,39}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  -- Opaque printable ASCII without spaces, as the contract's provider values.
  account_id text NOT NULL CHECK (account_id ~ '^[!-~]{1,200}$'),
  -- AES-256-GCM: a 12-byte nonce, a token of 1 to 4096 bytes and a 16-byte tag.
  api_token bytea NOT NULL CHECK (octet_length(api_token) BETWEEN 29 AND 4124),
  api_token_key_version smallint NOT NULL CHECK (api_token_key_version >= 1),
  callback_reference_hash bytea NOT NULL CHECK (octet_length(callback_reference_hash) = 32),
  callback_key_version smallint NOT NULL CHECK (callback_key_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
-- Across all tenants, so the callback function finds at most one row.
CREATE UNIQUE INDEX signature_connection_callback
  ON app.signature_connection (callback_reference_hash);
CREATE UNIQUE INDEX signature_connection_active ON app.signature_connection (tenant_id, provider)
  WHERE status = 'active';
SELECT app.enable_tenant_rls('app.signature_connection');
-- app_operator, which these denials do not name, writes through its grants.
SELECT app.deny_command('app.signature_connection', 'INSERT');
SELECT app.deny_command('app.signature_connection', 'UPDATE');
SELECT app.deny_command('app.signature_connection', 'DELETE');

CREATE FUNCTION app.keep_signature_connection()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'active';
    NEW.created_at := pg_catalog.now();
  ELSIF (NEW.tenant_id, NEW.id, NEW.provider, NEW.account_id, NEW.created_at)
        IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.provider, OLD.account_id, OLD.created_at)
        OR (OLD.status = 'closed' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Only the token, callback reference and status of an open signature connection can change.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_signature_connection BEFORE INSERT OR UPDATE ON app.signature_connection
  FOR EACH ROW EXECUTE FUNCTION app.keep_signature_connection();

-- The operator command creates and closes connections and replaces a token,
-- or a callback reference with its key version.
GRANT SELECT (tenant_id, id, provider, status) ON app.signature_connection TO app_api;
GRANT SELECT (tenant_id, id, provider, status, account_id, api_token, api_token_key_version)
   ON app.signature_connection TO app_worker;
GRANT SELECT (tenant_id, id, provider, status),
      INSERT (tenant_id, provider, account_id, api_token, api_token_key_version,
              callback_reference_hash, callback_key_version),
      UPDATE (status, api_token, api_token_key_version, callback_reference_hash,
              callback_key_version)
   ON app.signature_connection TO app_operator;
