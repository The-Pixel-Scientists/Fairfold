-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0037, up: the job an audit event was written by, and the
-- membership whose request caused it (ADR 0009, "job audit records a system
-- actor, the job id and the originating user"; S11-55, S11-64).
--
-- A job's event keeps actor_kind 'system', so every reader of the actor
-- stays as it is, and names its pg-boss job in job_id. pg-boss archives and
-- deletes jobs, so job_id has no foreign key. origin_membership_id is the
-- membership that caused the job, if any; a scheduled job has none. The
-- composite key with tenant_id keeps it in the event's tenant, since
-- foreign key checks ignore row-level security. request_id stays its own:
-- a job's event gets a new one, never the job id.
--
-- No row is rewritten: both columns have no default, past events keep
-- nulls, and each constraint is added NOT VALID and then validated. The
-- restrictive UPDATE and DELETE policies cover both columns as they cover
-- every other; the tenant SELECT and INSERT policies are unchanged.
ALTER TABLE app.audit_event ADD COLUMN job_id uuid;
ALTER TABLE app.audit_event ADD COLUMN origin_membership_id uuid;

ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_job
  CHECK (job_id IS NULL OR actor_kind = 'system') NOT VALID;
ALTER TABLE app.audit_event VALIDATE CONSTRAINT audit_event_job;
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_job_origin
  CHECK (origin_membership_id IS NULL OR job_id IS NOT NULL) NOT VALID;
ALTER TABLE app.audit_event VALIDATE CONSTRAINT audit_event_job_origin;
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_origin_membership
  FOREIGN KEY (tenant_id, origin_membership_id) REFERENCES app.membership (tenant_id, id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE app.audit_event VALIDATE CONSTRAINT audit_event_origin_membership;

CREATE INDEX audit_event_job ON app.audit_event (tenant_id, job_id) WHERE job_id IS NOT NULL;

-- Only the worker runs jobs, so only app_worker may name one.
GRANT INSERT (job_id, origin_membership_id) ON app.audit_event TO app_worker;
