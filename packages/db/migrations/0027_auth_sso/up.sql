-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0027, up: single sign-on (ADR 0010, "Data and roles", "Secrets
-- at rest" and "SSO"; ADR 0003's named exceptions; S11-60).
--
-- - auth.sso_provider: a tenant's OIDC or SAML provider. Its settings are
--   typed columns, and its one secret (an OIDC client secret or a SAML
--   signing key) is AES-256-GCM ciphertext that the API seals with the
--   table, column, row id and tenant id as associated data, beside the key
--   version that sealed it.
-- - auth.sso_domain: an email domain a provider claims, proven by a DNS TXT
--   record holding the row's random token. A domain is verified in one
--   tenant at most, and a pending claim blocks nobody.
-- - auth.saml_replay: used SAML assertion ids, kept until they expire.
-- - auth.account gains SSO identities: a BEFORE INSERT trigger sets the
--   tenant, provider and issuer from the provider in the current tenant,
--   and only credential accounts have no tenant.
-- - auth.sso_providers_by_key_version(version): the approved definer
--   function the secret re-encryption command calls.
--
-- The three new tables are tenant tables under row-level security, and only
-- app_auth holds grants on them. Existing credential accounts are not
-- rewritten; adding the checks reads them without changing them.

CREATE TABLE auth.sso_provider (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  -- Set by the API, which needs it before the row exists to seal the secret.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('oidc', 'saml')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  -- OIDC: the issuer and the endpoints its discovery document gave on save.
  issuer text CHECK (char_length(issuer) <= 2048 AND issuer ~ '^https://'),
  client_id text CHECK (char_length(client_id) BETWEEN 1 AND 256),
  client_secret bytea CHECK (octet_length(client_secret) BETWEEN 29 AND 1052),
  authorization_endpoint text CHECK (
    char_length(authorization_endpoint) <= 2048 AND authorization_endpoint ~ '^https://'),
  token_endpoint text CHECK (char_length(token_endpoint) <= 2048 AND token_endpoint ~ '^https://'),
  jwks_uri text CHECK (char_length(jwks_uri) <= 2048 AND jwks_uri ~ '^https://'),
  userinfo_endpoint text CHECK (
    char_length(userinfo_endpoint) <= 2048 AND userinfo_endpoint ~ '^https://'),
  -- The amr and acr values that count as MFA at the provider.
  mfa_amr text[] CHECK (array_ndims(mfa_amr) = 1 AND cardinality(mfa_amr) <= 10),
  mfa_acr text[] CHECK (array_ndims(mfa_acr) = 1 AND cardinality(mfa_acr) <= 10),
  -- SAML: the IdP's entity id, sign-in URL and signing certificates, and
  -- our own signing certificate and key for a provider that wants signed
  -- requests.
  entity_id text CHECK (char_length(entity_id) BETWEEN 1 AND 1024),
  sso_url text CHECK (char_length(sso_url) <= 2048 AND sso_url ~ '^https://'),
  certificates text[] CHECK (
    array_ndims(certificates) = 1 AND cardinality(certificates) BETWEEN 1 AND 3
    AND char_length(array_to_string(certificates, '')) <= 24576
    AND array_to_string(certificates, ',') ~
      '^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----(,-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----)*$'),
  sp_certificate text CHECK (
    char_length(sp_certificate) <= 8192 AND sp_certificate ~
      '^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----$'),
  sp_private_key bytea CHECK (octet_length(sp_private_key) BETWEEN 29 AND 8220),
  -- The AuthnContextClassRef values that count as MFA.
  mfa_contexts text[] CHECK (array_ndims(mfa_contexts) = 1 AND cardinality(mfa_contexts) <= 10),
  -- The version of the key that sealed the row's secret.
  key_version smallint CHECK (key_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT sso_provider_oidc CHECK (kind <> 'oidc' OR (
    issuer IS NOT NULL AND client_id IS NOT NULL AND client_secret IS NOT NULL
    AND authorization_endpoint IS NOT NULL AND token_endpoint IS NOT NULL
    AND jwks_uri IS NOT NULL AND mfa_amr IS NOT NULL AND mfa_acr IS NOT NULL)),
  CONSTRAINT sso_provider_saml CHECK (kind <> 'saml' OR (
    entity_id IS NOT NULL AND sso_url IS NOT NULL AND certificates IS NOT NULL
    AND mfa_contexts IS NOT NULL)),
  CONSTRAINT sso_provider_oidc_only CHECK (kind = 'oidc' OR num_nonnulls(
    issuer, client_id, client_secret, authorization_endpoint, token_endpoint, jwks_uri,
    userinfo_endpoint, mfa_amr, mfa_acr) = 0),
  CONSTRAINT sso_provider_saml_only CHECK (kind = 'saml' OR num_nonnulls(
    entity_id, sso_url, certificates, sp_certificate, sp_private_key, mfa_contexts) = 0),
  CONSTRAINT sso_provider_sp_pair CHECK ((sp_certificate IS NULL) = (sp_private_key IS NULL)),
  CONSTRAINT sso_provider_key_version CHECK (
    (key_version IS NULL) = (client_secret IS NULL AND sp_private_key IS NULL))
);

CREATE TABLE auth.sso_domain (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  -- Normalised once by the API: lower case, IDNA A-labels, no trailing dot.
  domain text NOT NULL CHECK (
    char_length(domain) <= 253
    AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'),
  -- 32 random bytes in unpadded base64url, published in DNS, so not a secret.
  dns_token text NOT NULL CHECK (dns_token ~ '^[A-Za-z0-9_-]{43}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'verified')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  -- One provider per domain within a tenant, so sign-in finds one.
  UNIQUE (tenant_id, domain),
  FOREIGN KEY (tenant_id, provider_id) REFERENCES auth.sso_provider (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT sso_domain_verified CHECK ((state = 'verified') = (verified_at IS NOT NULL))
);
-- ADR 0003's named exception to rule 6: unique across tenants, among
-- verified rows only.
CREATE UNIQUE INDEX sso_domain_verified_once ON auth.sso_domain (domain) WHERE state = 'verified';
CREATE INDEX sso_domain_provider ON auth.sso_domain (tenant_id, provider_id);

-- A used assertion id, refused if seen again from the same provider before
-- it expires. It comes before sign-in, so no member wrote it.
CREATE TABLE auth.saml_replay (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  assertion_id text NOT NULL CHECK (char_length(assertion_id) BETWEEN 1 AND 256),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider_id, assertion_id),
  FOREIGN KEY (tenant_id, provider_id) REFERENCES auth.sso_provider (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT saml_replay_expiry CHECK (expires_at > created_at)
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON auth.sso_provider
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON auth.sso_domain
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

SELECT app.enable_tenant_rls('auth.sso_provider');
SELECT app.enable_tenant_rls('auth.sso_domain');
SELECT app.enable_tenant_rls('auth.saml_replay');
SELECT app.deny_command('auth.saml_replay', 'UPDATE');
-- Only an expired assertion id may go.
CREATE POLICY saml_replay_delete_expired ON auth.saml_replay AS RESTRICTIVE FOR DELETE
  TO app_auth USING (expires_at <= now());

-- The kind and tenant never change; a change of kind is a new provider.
GRANT SELECT, DELETE,
      INSERT (tenant_id, id, kind, name, issuer, client_id, client_secret, authorization_endpoint,
              token_endpoint, jwks_uri, userinfo_endpoint, mfa_amr, mfa_acr, entity_id, sso_url,
              certificates, sp_certificate, sp_private_key, mfa_contexts, key_version,
              created_by, updated_by),
      UPDATE (name, issuer, client_id, client_secret, authorization_endpoint, token_endpoint,
              jwks_uri, userinfo_endpoint, mfa_amr, mfa_acr, entity_id, sso_url, certificates,
              sp_certificate, sp_private_key, mfa_contexts, key_version, updated_by)
   ON auth.sso_provider TO app_auth;
GRANT SELECT, DELETE,
      INSERT (tenant_id, provider_id, domain, dns_token, created_by, updated_by),
      UPDATE (state, verified_at, updated_by)
   ON auth.sso_domain TO app_auth;
GRANT SELECT, DELETE, INSERT (tenant_id, provider_id, assertion_id, expires_at)
   ON auth.saml_replay TO app_auth;

-- SSO identities (ADR 0010, ADR 0003's auth.account exception). For an SSO
-- account, provider_id is the provider's id as text, account_id its
-- subject (OIDC sub or SAML NameID), and the trigger below sets tenant_id,
-- sso_provider_id and sso_issuer. app_auth may insert none of the three and
-- update neither of the first two: its grants are unchanged.
ALTER TABLE auth.account
  ADD COLUMN tenant_id uuid,
  ADD COLUMN sso_provider_id uuid,
  ADD COLUMN sso_issuer text CHECK (char_length(sso_issuer) BETWEEN 1 AND 2048),
  ALTER COLUMN password DROP NOT NULL,
  DROP CONSTRAINT account_provider_id_check,
  DROP CONSTRAINT account_credential_id,
  ADD CONSTRAINT account_sso_pair CHECK ((tenant_id IS NULL) = (sso_provider_id IS NULL)),
  ADD CONSTRAINT account_tenant_only_sso CHECK ((provider_id = 'credential') = (tenant_id IS NULL)),
  ADD CONSTRAINT account_sso_provider_id CHECK (
    provider_id = 'credential' OR provider_id = sso_provider_id::text),
  ADD CONSTRAINT account_sso_issuer CHECK ((tenant_id IS NULL) = (sso_issuer IS NULL)),
  ADD CONSTRAINT account_password CHECK ((provider_id = 'credential') = (password IS NOT NULL)),
  ADD CONSTRAINT account_credential_id CHECK (
    provider_id <> 'credential' OR account_id = user_id::text),
  ADD CONSTRAINT account_subject CHECK (char_length(account_id) BETWEEN 1 AND 512),
  ADD CONSTRAINT account_sso_identity UNIQUE (tenant_id, sso_provider_id, sso_issuer, account_id),
  ADD CONSTRAINT account_sso_provider_fkey FOREIGN KEY (tenant_id, sso_provider_id)
    REFERENCES auth.sso_provider (tenant_id, id) ON DELETE CASCADE;

-- Credential accounts get no tenant. Any other account takes its tenant,
-- provider and issuer from the provider its provider_id names in the
-- current tenant, whatever the insert supplied, or is refused.
CREATE FUNCTION auth.set_sso_identity()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  provider record;
BEGIN
  IF NEW.provider_id = 'credential' THEN
    NEW.tenant_id := NULL;
    NEW.sso_provider_id := NULL;
    NEW.sso_issuer := NULL;
    RETURN NEW;
  END IF;
  SELECT p.tenant_id, p.id, COALESCE(p.issuer, p.entity_id) AS issuer
    INTO provider
    FROM auth.sso_provider AS p
   WHERE p.tenant_id = app.current_tenant_id()
     AND p.id::text = NEW.provider_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An SSO identity needs its provider in the current tenant.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.tenant_id := provider.tenant_id;
  NEW.sso_provider_id := provider.id;
  NEW.sso_issuer := provider.issuer;
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_sso_identity BEFORE INSERT ON auth.account
  FOR EACH ROW EXECUTE FUNCTION auth.set_sso_identity();

DROP POLICY auth_select ON auth.account;
DROP POLICY auth_insert ON auth.account;
DROP POLICY auth_update ON auth.account;
CREATE POLICY auth_select ON auth.account FOR SELECT TO app_auth, migrator
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant_id());
CREATE POLICY auth_insert ON auth.account FOR INSERT TO app_auth, migrator
  WITH CHECK (tenant_id IS NULL OR tenant_id = app.current_tenant_id());
CREATE POLICY auth_update ON auth.account FOR UPDATE TO app_auth, migrator
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = app.current_tenant_id());

-- The providers whose secret the key of `version` sealed, in every tenant
-- whatever its status, for the re-encryption command (ADR 0003, "Approved
-- definer functions"). Ids only.
CREATE FUNCTION auth.sso_providers_by_key_version(version integer)
  RETURNS TABLE (id uuid, tenant_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT p.id, p.tenant_id
    FROM auth.sso_provider AS p
   WHERE p.key_version = sso_providers_by_key_version.version
   ORDER BY p.tenant_id, p.id;
END;

-- Its owner reads only these columns, through one policy.
GRANT USAGE ON SCHEMA auth TO owner_auth_sso_providers_by_key_version;
GRANT SELECT (id, tenant_id, key_version) ON auth.sso_provider
   TO owner_auth_sso_providers_by_key_version;
CREATE POLICY sso_providers_by_key_version_select ON auth.sso_provider FOR SELECT
  TO owner_auth_sso_providers_by_key_version USING (true);

-- Hand the function to its owner (ADR 0023): grants first, CREATE only for
-- the handover.
REVOKE ALL ON FUNCTION auth.sso_providers_by_key_version(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.sso_providers_by_key_version(integer) TO app_auth;
GRANT CREATE ON SCHEMA auth TO owner_auth_sso_providers_by_key_version;
ALTER FUNCTION auth.sso_providers_by_key_version(integer)
  OWNER TO owner_auth_sso_providers_by_key_version;
REVOKE CREATE ON SCHEMA auth FROM owner_auth_sso_providers_by_key_version;
