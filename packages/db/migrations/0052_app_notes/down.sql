-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0052, down: remove the notes, messages, tags and notification
-- outbox, in reverse order. Rows cannot come back, so outside development the
-- rollback for this migration is a restore from backup. Waiting notification
-- jobs are lost with their queue, so the rollback stops while any are queued.
-- Nothing cascades: while a later migration's objects still refer to these
-- tables, this fails and changes nothing. The owner role stays: the roles
-- script, not a migration, creates and removes roles.

DO $check$
BEGIN
  IF EXISTS (SELECT FROM pgboss.job
             WHERE name IN ('grants.message_notification', 'grants.message_notification.dead')
               AND state IN ('created', 'retry', 'active')) THEN
    RAISE EXCEPTION 'Queue grants.message_notification holds jobs. Let the worker finish them before this rollback.';
  END IF;
END
$check$;

DROP FUNCTION app.erase_subject_notes(uuid);
REVOKE SELECT (tenant_id, id, status) ON party.party FROM owner_app_erase_notes;
REVOKE SELECT (tenant_id, id, applicant_person_id) ON grants.application FROM owner_app_erase_notes;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_app_erase_notes;
REVOKE USAGE ON SCHEMA app, grants, party FROM owner_app_erase_notes;

DELETE FROM app.job_queue
 WHERE name IN ('grants.message_notification', 'grants.message_notification.dead');
SELECT pgboss.delete_queue('grants.message_notification');
SELECT pgboss.delete_queue('grants.message_notification.dead');

DROP TABLE grants.message_notification;
DROP TABLE grants.application_message;
DROP TABLE grants.application_note;
DROP TABLE app.message;
DROP TABLE app.message_thread;
DROP TABLE app.note_mention;
DROP TABLE app.note;
DROP TABLE app.tag;
DROP FUNCTION app.refuse_erased_applicant_message();
DROP FUNCTION app.refuse_erased_applicant_note();
DROP FUNCTION grants.refuse_erased_applicant_link();
DROP FUNCTION app.check_applicant_message();
DROP FUNCTION app.keep_message_thread();
DROP FUNCTION app.check_note_mention_cap();
DROP FUNCTION app.set_created_at();
