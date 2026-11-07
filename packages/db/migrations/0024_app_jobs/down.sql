-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0024, down: remove app.tenant_ids() and its owner's rights and
-- policy, the tenant trigger and its function, the queue register and the
-- pgboss schema with every job in it. Jobs cannot come back, so a rollback
-- loses any that are queued.

DROP FUNCTION app.tenant_ids();
DROP POLICY tenant_ids_select ON app.tenant;
REVOKE SELECT (id, status) ON app.tenant FROM owner_app_tenant_ids;
REVOKE USAGE ON SCHEMA app FROM owner_app_tenant_ids;

DROP TRIGGER check_job ON pgboss.job;
DROP FUNCTION app.check_job();
DROP TABLE app.job_queue;
DROP SCHEMA pgboss CASCADE;
