-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0060, up: a round's reminder setting (S12-21, E9), as versioned
-- configuration (rule 10). Values copy modules/grants/src/contracts/reminders.
-- The database counts its versions and sets its times; the server writes the
-- app.config_version row and the audit event in the same transaction
-- (S12-50). The setting names no person.

-- Draft reminders are a whole number of days before the effective closing
-- time, stored largest first so each is distinct; a review is overdue a
-- number of days after it was assigned, then every repeat interval.
CREATE TABLE grants.reminder_setting (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  draft_enabled boolean NOT NULL,
  draft_days_before_1 integer CHECK (draft_days_before_1 BETWEEN 1 AND 30),
  draft_days_before_2 integer CHECK (draft_days_before_2 BETWEEN 1 AND 30),
  draft_days_before_3 integer CHECK (draft_days_before_3 BETWEEN 1 AND 30),
  draft_template_version_id uuid,
  review_enabled boolean NOT NULL,
  review_overdue_after_days integer NOT NULL CHECK (review_overdue_after_days BETWEEN 1 AND 60),
  review_repeat_every_days integer NOT NULL CHECK (review_repeat_every_days BETWEEN 1 AND 30),
  review_template_version_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT reminder_setting_once UNIQUE (tenant_id, round_id),
  CONSTRAINT reminder_setting_draft_days CHECK (
    (draft_days_before_2 IS NULL OR (draft_days_before_2 < draft_days_before_1) IS TRUE)
    AND (draft_days_before_3 IS NULL OR (draft_days_before_3 < draft_days_before_2) IS TRUE)),
  CONSTRAINT reminder_setting_draft_on CHECK (
    NOT draft_enabled
    OR (draft_days_before_1 IS NOT NULL AND draft_template_version_id IS NOT NULL)),
  CONSTRAINT reminder_setting_review_on CHECK (
    NOT review_enabled OR review_template_version_id IS NOT NULL),
  FOREIGN KEY (tenant_id, round_id) REFERENCES grants.round (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, draft_template_version_id)
    REFERENCES grants.email_template_version (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, review_template_version_id)
    REFERENCES grants.email_template_version (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.reminder_setting');
SELECT app.deny_command('grants.reminder_setting', 'DELETE');

-- A new setting is version 1 and each update the next, whatever the caller
-- sends; its round and creation never change.
CREATE FUNCTION grants.version_reminder_setting()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
    NEW.created_at := pg_catalog.now();
  ELSIF (NEW.tenant_id, NEW.id, NEW.round_id, NEW.created_at, NEW.created_by) IS DISTINCT FROM
        (OLD.tenant_id, OLD.id, OLD.round_id, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'Only the timing, switches and emails of a reminder setting can change.'
      USING ERRCODE = 'check_violation';
  ELSE
    NEW.version := OLD.version + 1;
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$function$;
CREATE TRIGGER version_reminder_setting BEFORE INSERT OR UPDATE ON grants.reminder_setting
  FOR EACH ROW EXECUTE FUNCTION grants.version_reminder_setting();

GRANT SELECT,
      INSERT (tenant_id, round_id, draft_enabled, draft_days_before_1, draft_days_before_2,
              draft_days_before_3, draft_template_version_id, review_enabled,
              review_overdue_after_days, review_repeat_every_days, review_template_version_id,
              created_by, updated_by),
      UPDATE (draft_enabled, draft_days_before_1, draft_days_before_2, draft_days_before_3,
              draft_template_version_id, review_enabled, review_overdue_after_days,
              review_repeat_every_days, review_template_version_id, updated_by)
   ON grants.reminder_setting TO app_api;
GRANT SELECT ON grants.reminder_setting TO app_worker;
