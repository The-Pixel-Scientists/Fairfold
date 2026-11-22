-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0074, up: each email template version says whether it is a
-- service (transactional) or marketing email (ADR 0033; S12-53), copying
-- S11-58's list in modules/grants/src/contracts/programme/templates.ts.
--
-- A constant default fills every existing version without rewriting or
-- updating a row, so the release and reminder templates read as
-- transactional. The default stays so the existing template writers keep
-- working; marketing is sent only from a version explicitly marked
-- marketing (S12-63). ADR 0033, still proposed, asks for the default to be
-- dropped once every writer names its purpose. A version is never updated,
-- so its purpose changes only with a new version.
ALTER TABLE grants.email_template_version
  ADD COLUMN purpose text NOT NULL DEFAULT 'transactional'
    CONSTRAINT email_template_version_purpose_check
    CHECK (purpose IN ('transactional', 'marketing'));
GRANT INSERT (purpose) ON grants.email_template_version TO app_api;
