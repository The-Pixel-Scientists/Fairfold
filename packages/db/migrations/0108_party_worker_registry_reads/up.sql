-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0108, up: the registry refresh job (ADR 0031) runs as app_worker
-- and re-reads the organisation it was asked about through party's server:
-- its legal form, and the identifier it claims on a register with whether
-- staff verified it. The worker already reads an organisation's tenant, id
-- and name. An identifier's tenant and id are included because the
-- cross-tenant test reads them as every role with a grant, as the earlier
-- worker grants do. SELECT only, on the named columns: row-level security
-- keeps the read to the job's tenant, and the worker still cannot write
-- either table or read an identifier's actors.

GRANT SELECT (legal_form) ON party.organisation TO app_worker;
GRANT SELECT (tenant_id, id, organisation_id, scheme, identifier, verified_at)
  ON party.organisation_identifier TO app_worker;
