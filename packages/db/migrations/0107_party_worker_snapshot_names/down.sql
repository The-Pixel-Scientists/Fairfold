-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0107, down: take back app_worker's read of a snapshot's tenant,
-- id and name.

REVOKE SELECT (tenant_id, id, name) ON party.organisation_snapshot FROM app_worker;
