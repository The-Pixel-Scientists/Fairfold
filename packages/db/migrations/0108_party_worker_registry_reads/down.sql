-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0108, down: take back app_worker's read of an organisation's
-- legal form and of its identifiers.

REVOKE SELECT (tenant_id, id, organisation_id, scheme, identifier, verified_at)
  ON party.organisation_identifier FROM app_worker;
REVOKE SELECT (legal_form) ON party.organisation FROM app_worker;
