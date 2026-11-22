-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0074, down: drop the template purpose, with its check and
-- grant. A marketing version would read as a service email once it is
-- gone, so this refuses, before it changes anything, while any exists.
-- Row-level security hides every tenant's rows from migrator, but
-- validating a check reads every row whatever the policies.
DO $refuse$
BEGIN
  ALTER TABLE grants.email_template_version
    ADD CONSTRAINT rollback_transactional CHECK (purpose = 'transactional');
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0074 cannot be rolled back while a template version is marketing: it would read as a service email.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$refuse$;

-- Dropping the column drops its checks and its column grant.
ALTER TABLE grants.email_template_version DROP COLUMN purpose;
