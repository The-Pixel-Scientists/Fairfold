-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0107, up: the board pack job (S12-78) prints each application's
-- organisation as submitted, so app_worker reads a snapshot's id and name,
-- and its tenant, which the cross-tenant test reads as every role with a
-- grant. SELECT only: row-level security keeps the read to the
-- transaction's tenant, and the worker still cannot write a snapshot.

GRANT SELECT (tenant_id, id, name) ON party.organisation_snapshot TO app_worker;
