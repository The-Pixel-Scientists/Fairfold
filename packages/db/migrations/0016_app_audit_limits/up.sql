-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0016, up: limits on audit events, and the second pass fixes for
-- invitations, tenant names and scored criteria (S11-24).
--
-- No row is rewritten or updated. Each check is added NOT VALID and then
-- validated, which reads every row whatever the policies; if a row breaks
-- one, the migration fails naming the check and changes nothing.

-- An event's changes are at most 64 KiB as text. The writer refuses larger
-- ones first (insertAuditEvent in packages/db/src/audit.ts).
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_changes_size
  CHECK (octet_length(changes::text) <= 65536) NOT VALID;
ALTER TABLE app.audit_event VALIDATE CONSTRAINT audit_event_changes_size;

-- Whether the acting member was staff or an applicant when the event was
-- written, so a later role change does not alter how it reads. The trigger
-- sets it from the membership, in the inserting transaction and with that
-- role's rights; no role may supply it. Staff hold a console role and no
-- portal role, as the audit log contract (packages/domain) defines them;
-- applicant is the one portal role, which a test keeps in step. Events
-- written before this migration have none.
ALTER TABLE app.audit_event ADD COLUMN actor_member_kind text;
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_actor_member_kind CHECK (
  actor_member_kind IS NULL
  OR (actor_kind = 'user' AND actor_member_kind IN ('staff', 'applicant'))) NOT VALID;
ALTER TABLE app.audit_event VALIDATE CONSTRAINT audit_event_actor_member_kind;

CREATE FUNCTION app.set_audit_actor_member_kind()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.actor_member_kind := NULL;
  IF NEW.actor_kind = 'user' THEN
    SELECT CASE WHEN 'applicant' = ANY (m.roles) THEN 'applicant' ELSE 'staff' END
      INTO NEW.actor_member_kind
      FROM app.membership m
     WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.actor_id;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_audit_actor_member_kind BEFORE INSERT ON app.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.set_audit_actor_member_kind();

-- P1-03: an invitation cannot be accepted once it has expired. It can
-- still be revoked, as a new invitation to the same address does.
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
  IF NEW.status = 'accepted' AND pg_catalog.now() >= OLD.expires_at THEN
    RAISE EXCEPTION 'Invitation % has expired.', OLD.id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;

-- P1-11: the tenant name backstop also refuses every format character
-- that tenantNameSchema does, as the grants text checks list them, and the
-- invisible combining grapheme joiner and Hangul fillers.
ALTER TABLE app.tenant DROP CONSTRAINT tenant_name_check;
ALTER TABLE app.tenant ADD CONSTRAINT tenant_name_check CHECK (
  char_length(name) BETWEEN 1 AND 100
  AND btrim(name) <> ''
  AND name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufeff\uffa0\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]')
  NOT VALID;
ALTER TABLE app.tenant VALIDATE CONSTRAINT tenant_name_check;

-- P3-03: once a submitted review has scored a criterion, its weight and
-- scale are fixed, so the scores already given keep their meaning.
CREATE FUNCTION grants.keep_scored_criterion()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF (NEW.weight, NEW.scale_min, NEW.scale_max) IS DISTINCT FROM
       (OLD.weight, OLD.scale_min, OLD.scale_max)
     AND EXISTS (
       SELECT FROM grants.score s
         JOIN grants.assignment a ON a.tenant_id = s.tenant_id AND a.id = s.assignment_id
        WHERE s.tenant_id = OLD.tenant_id AND s.criterion_id = OLD.id
          AND a.status = 'submitted') THEN
    RAISE EXCEPTION 'Criterion % has scores from submitted reviews.', OLD.id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_scored_criterion BEFORE UPDATE OF weight, scale_min, scale_max
  ON grants.rubric_criterion
  FOR EACH ROW EXECUTE FUNCTION grants.keep_scored_criterion();
