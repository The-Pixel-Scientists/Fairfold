-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0018, down: remove the audit event subject in reverse order.
-- Dropping the column loses the subjects recorded since 0018, and those
-- events then read like the ones written before it; every other audit value
-- stays. To keep them, restore the backup taken before the rollback (ADR
-- 0003).

REVOKE INSERT (subject_party_id) ON app.audit_event FROM app_api, app_worker;
DROP INDEX app.audit_event_subject;
ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_subject_party;
ALTER TABLE app.audit_event DROP COLUMN subject_party_id;
