-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0027, down: remove single sign-on and restore auth.account as
-- migration 0004 made it, for credential accounts only.
--
-- An SSO identity cannot be expressed before 0027, and auth.account rows
-- are never deleted, so while any exists the block below turns the failed
-- check into a clear error and the rollback changes nothing. Otherwise it
-- drops every tenant's SSO providers, domains and used assertion ids; to
-- keep them, restore the backup taken before the rollback (ADR 0003).

DROP FUNCTION auth.sso_providers_by_key_version(integer);
REVOKE USAGE ON SCHEMA auth FROM owner_auth_sso_providers_by_key_version;

DROP POLICY auth_select ON auth.account;
DROP POLICY auth_insert ON auth.account;
DROP POLICY auth_update ON auth.account;
CREATE POLICY auth_select ON auth.account FOR SELECT TO app_auth, migrator USING (true);
CREATE POLICY auth_insert ON auth.account FOR INSERT TO app_auth, migrator WITH CHECK (true);
CREATE POLICY auth_update ON auth.account FOR UPDATE TO app_auth, migrator USING (true) WITH CHECK (true);

DROP TRIGGER set_sso_identity ON auth.account;
DROP FUNCTION auth.set_sso_identity();

DO $restore$
BEGIN
  ALTER TABLE auth.account
    DROP CONSTRAINT account_credential_id,
    ADD CONSTRAINT account_provider_id_check CHECK (provider_id = 'credential'),
    ADD CONSTRAINT account_credential_id CHECK (account_id = user_id::text),
    ALTER COLUMN password SET NOT NULL;
EXCEPTION WHEN check_violation OR not_null_violation THEN
  RAISE EXCEPTION 'Migration 0027 cannot be rolled back: auth.account holds SSO identities.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

ALTER TABLE auth.account
  DROP CONSTRAINT account_sso_provider_fkey,
  DROP CONSTRAINT account_sso_identity,
  DROP CONSTRAINT account_subject,
  DROP CONSTRAINT account_password,
  DROP CONSTRAINT account_sso_issuer,
  DROP CONSTRAINT account_sso_provider_id,
  DROP CONSTRAINT account_tenant_only_sso,
  DROP CONSTRAINT account_sso_pair,
  DROP COLUMN sso_issuer,
  DROP COLUMN sso_provider_id,
  DROP COLUMN tenant_id;

DROP TABLE auth.saml_replay;
DROP TABLE auth.sso_domain;
DROP TABLE auth.sso_provider;
