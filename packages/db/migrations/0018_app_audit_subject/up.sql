-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0018, up: the party an audit event is about (ADR 0027, "The
-- subject party id"), so subject access finds every event about a person.
--
-- No row is rewritten or updated: the column has no default, and past
-- events keep a null subject. It is the one audit foreign key into a module
-- schema. Party never deletes a referenced row (ADR 0017), so the key never
-- cascades or sets null. Foreign key checks ignore row-level security, so
-- the composite key with tenant_id is what keeps a subject in the event's
-- tenant. The key is added NOT VALID and then validated, which reads every
-- row without changing it. The triggers that set occurred_at, retain_until
-- and actor_member_kind leave the column alone, and the restrictive UPDATE
-- and DELETE policies cover it as they cover every other.
ALTER TABLE app.audit_event ADD COLUMN subject_party_id uuid;
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_subject_party
  FOREIGN KEY (tenant_id, subject_party_id) REFERENCES party.party (tenant_id, id)
  ON DELETE NO ACTION NOT VALID;
ALTER TABLE app.audit_event VALIDATE CONSTRAINT audit_event_subject_party;

CREATE INDEX audit_event_subject ON app.audit_event (tenant_id, subject_party_id)
  WHERE subject_party_id IS NOT NULL;

-- The roles that already insert events may name their subject.
GRANT INSERT (subject_party_id) ON app.audit_event TO app_api, app_worker;
