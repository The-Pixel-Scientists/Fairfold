-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0090, up: the breach log and its assessments (UK GDPR Articles
-- 33 and 34), under the rules migration 0089 sets out. Telling the ICO and
-- telling the people affected are each a write by app_api after a named
-- member's action: nothing here notifies anyone or decides that a breach is
-- notifiable (rule 9).

-- The breach log (UK GDPR Article 33(5)). became_aware_at starts the
-- 72-hour clock and never changes. The checks compare instants only:
-- whether a breach must be reported is a member's assessment. Telling the
-- ICO and telling the people affected are each recorded once, with the
-- member who did it, at a time the database sets.
CREATE TABLE privacy.breach (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  became_aware_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL,
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 5000)
    CONSTRAINT breach_description_text CHECK (description !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  data_categories text[] NOT NULL
    CONSTRAINT breach_data_categories_count
      CHECK (cardinality(data_categories) BETWEEN 1 AND 16 AND array_ndims(data_categories) = 1)
    CONSTRAINT breach_data_categories_known CHECK (data_categories <@ ARRAY['identity', 'contact',
      'financial', 'location', 'online_identifiers', 'children', 'criminal_offences',
      'racial_or_ethnic_origin', 'political_opinions', 'religious_or_philosophical_beliefs',
      'trade_union_membership', 'genetic', 'biometric', 'health', 'sex_life_or_orientation',
      'other']::text[]),
  approx_subjects bigint CHECK (approx_subjects >= 0),
  approx_records bigint CHECK (approx_records >= 0),
  consequences text NOT NULL DEFAULT '' CHECK (char_length(consequences) <= 5000)
    CONSTRAINT breach_consequences_text CHECK (consequences !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  measures text NOT NULL DEFAULT '' CHECK (char_length(measures) <= 5000)
    CONSTRAINT breach_measures_text CHECK (measures !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  ico_notified_at timestamptz,
  ico_reference text CHECK (char_length(ico_reference) BETWEEN 1 AND 100)
    CONSTRAINT breach_ico_reference_text CHECK (ico_reference !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  ico_late_reason text CHECK (ico_late_reason IN ('still_investigating', 'processor_reported_late',
    'reported_in_phases', 'other')),
  ico_recorded_by uuid,
  ico_recorded_at timestamptz,
  subjects_notified_at timestamptz,
  subjects_notice_method text
    CHECK (subjects_notice_method IN ('email', 'post', 'phone', 'in_person')),
  subjects_recorded_by uuid,
  subjects_recorded_at timestamptz,
  recorded_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT breach_ico_notice
    CHECK (num_nulls(ico_notified_at, ico_reference, ico_recorded_by, ico_recorded_at) IN (0, 4)),
  CONSTRAINT breach_ico_after_aware CHECK (ico_notified_at >= became_aware_at),
  CONSTRAINT breach_ico_late CHECK ((ico_late_reason IS NOT NULL)
    = COALESCE(ico_notified_at > became_aware_at + interval '72 hours', false)),
  CONSTRAINT breach_subjects_notice CHECK (num_nulls(subjects_notified_at,
    subjects_notice_method, subjects_recorded_by, subjects_recorded_at) IN (0, 4)),
  FOREIGN KEY (tenant_id, ico_recorded_by) REFERENCES app.membership (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, subjects_recorded_by) REFERENCES app.membership (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX breach_aware ON privacy.breach (tenant_id, became_aware_at DESC, id);
SELECT app.enable_tenant_rls('privacy.breach');
SELECT app.deny_command('privacy.breach', 'DELETE');

-- A notification, once recorded, stays as recorded.
CREATE FUNCTION privacy.stamp_breach_notices()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.ico_notified_at IS NOT NULL
       AND (NEW.ico_notified_at, NEW.ico_reference, NEW.ico_late_reason, NEW.ico_recorded_by)
           IS DISTINCT FROM
           (OLD.ico_notified_at, OLD.ico_reference, OLD.ico_late_reason, OLD.ico_recorded_by)
     OR OLD.subjects_notified_at IS NOT NULL
       AND (NEW.subjects_notified_at, NEW.subjects_notice_method, NEW.subjects_recorded_by)
           IS DISTINCT FROM
           (OLD.subjects_notified_at, OLD.subjects_notice_method, OLD.subjects_recorded_by) THEN
    RAISE EXCEPTION 'A recorded notification stays as recorded.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.ico_recorded_at := CASE WHEN NEW.ico_notified_at IS NULL THEN NULL
                              WHEN OLD.ico_notified_at IS NULL THEN pg_catalog.now()
                              ELSE OLD.ico_recorded_at END;
  NEW.subjects_recorded_at := CASE WHEN NEW.subjects_notified_at IS NULL THEN NULL
                                   WHEN OLD.subjects_notified_at IS NULL THEN pg_catalog.now()
                                   ELSE OLD.subjects_recorded_at END;
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_created_at BEFORE INSERT ON privacy.breach
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON privacy.breach
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER stamp_breach_notices BEFORE UPDATE ON privacy.breach
  FOR EACH ROW EXECUTE FUNCTION privacy.stamp_breach_notices();
GRANT SELECT,
      INSERT (tenant_id, became_aware_at, discovered_at, description, data_categories,
              approx_subjects, approx_records, consequences, measures, recorded_by, updated_by),
      UPDATE (discovered_at, description, data_categories, approx_subjects, approx_records,
              consequences, measures, ico_notified_at, ico_reference, ico_late_reason,
              ico_recorded_by, subjects_notified_at, subjects_notice_method,
              subjects_recorded_by, updated_by)
   ON privacy.breach TO app_api;
GRANT SELECT (tenant_id, id, became_aware_at, ico_notified_at, recorded_by)
   ON privacy.breach TO app_worker;

-- A member's assessment of a breach's risk and whom to tell; the latest is
-- current. Assessments are never changed or removed.
CREATE TABLE privacy.breach_assessment (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  breach_id uuid NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('unlikely', 'risk', 'high_risk')),
  notify_ico boolean NOT NULL,
  notify_subjects boolean NOT NULL,
  rationale text NOT NULL DEFAULT '' CHECK (char_length(rationale) <= 5000)
    CONSTRAINT breach_assessment_rationale_text CHECK (rationale !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  assessed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, breach_id) REFERENCES privacy.breach (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, assessed_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX breach_assessment_breach
  ON privacy.breach_assessment (tenant_id, breach_id, created_at);
SELECT app.enable_tenant_rls('privacy.breach_assessment');
SELECT app.deny_command('privacy.breach_assessment', 'UPDATE');
SELECT app.deny_command('privacy.breach_assessment', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON privacy.breach_assessment
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
GRANT SELECT,
      INSERT (tenant_id, breach_id, risk_level, notify_ico, notify_subjects, rationale,
              assessed_by)
   ON privacy.breach_assessment TO app_api;
