-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0037, down: remove the job and originating membership of audit
-- events in reverse order. Dropping the columns loses them for the events
-- jobs wrote since 0037, which then read as plain system events; every
-- other audit value stays. To keep them, restore the backup taken before
-- the rollback (ADR 0003). Stop the worker first.

REVOKE INSERT (job_id, origin_membership_id) ON app.audit_event FROM app_worker;
DROP INDEX app.audit_event_job;
ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_origin_membership;
ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_job_origin;
ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_job;
ALTER TABLE app.audit_event DROP COLUMN origin_membership_id;
ALTER TABLE app.audit_event DROP COLUMN job_id;
