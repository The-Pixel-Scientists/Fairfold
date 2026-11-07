-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0016, down: undo each change in reverse order. Dropping
-- actor_member_kind loses the kinds recorded since 0016, and those events
-- then read like the ones written before it; every other audit value stays.
-- To keep them, restore the backup taken before the rollback (ADR 0003).

DROP TRIGGER keep_scored_criterion ON grants.rubric_criterion;
DROP FUNCTION grants.keep_scored_criterion();

ALTER TABLE app.tenant DROP CONSTRAINT tenant_name_check;
ALTER TABLE app.tenant ADD CONSTRAINT tenant_name_check CHECK (
  char_length(name) BETWEEN 1 AND 100
  AND btrim(name) <> ''
  AND name !~ '[\u0001-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2064\u2066-\u2069\ufeff]');

CREATE OR REPLACE FUNCTION app.keep_final_invitation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation % is final.', OLD.id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER set_audit_actor_member_kind ON app.audit_event;
DROP FUNCTION app.set_audit_actor_member_kind();
ALTER TABLE app.audit_event DROP COLUMN actor_member_kind;

ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_changes_size;
