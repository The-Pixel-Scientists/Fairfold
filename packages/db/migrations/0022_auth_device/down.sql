-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0022, down: remove device cookies and the per-device sign-in
-- counter, restoring auth.rate_limit as migration 0004 made it.
--
-- Device counters and devices cannot come back, so this deletes them: every
-- browser then counts as having no device cookie, which is the safe side.

DELETE FROM auth.rate_limit WHERE scope = 'sign_in_identifier_device';
REVOKE INSERT (device_id) ON auth.rate_limit FROM app_auth;
DROP INDEX auth.rate_limit_device;
ALTER TABLE auth.rate_limit
  DROP CONSTRAINT rate_limit_key,
  ADD CONSTRAINT rate_limit_scope_identifier_client_ip_key
    UNIQUE NULLS NOT DISTINCT (scope, identifier, client_ip),
  DROP CONSTRAINT rate_limit_device,
  DROP CONSTRAINT rate_limit_identifier,
  ADD CONSTRAINT rate_limit_identifier CHECK ((identifier IS NOT NULL) = (scope IN (
    'sign_in_identifier_ip', 'sign_in_identifier', 'email_identifier'))),
  DROP CONSTRAINT rate_limit_scope_check,
  ADD CONSTRAINT rate_limit_scope_check CHECK (scope IN (
    'sign_in_identifier_ip', 'sign_in_identifier', 'sign_in_ip', 'email_identifier', 'email_ip')),
  DROP COLUMN device_id;
DROP TABLE auth.device;
