-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0091, up: the processing activities and processors a tenant
-- records beside the generated record of processing (UK GDPR Article 30),
-- and the DPIA register (Article 35) with the activities each DPIA covers,
-- under the rules migration 0089 sets out. Signing off a DPIA is a write by
-- app_api after a named member's action (rule 9).

-- archived_at takes the database's time and, once set, stays.
CREATE FUNCTION privacy.set_archived_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'An archived row stays archived.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    NEW.archived_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;

-- A processing activity the tenant records beside the generated record of
-- processing (UK GDPR Article 30). It is retired by archiving, never removed.
CREATE TABLE privacy.processing_activity (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200)
    CONSTRAINT processing_activity_name_text CHECK (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 2000)
    CONSTRAINT processing_activity_purpose_text CHECK (purpose !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  legal_basis text NOT NULL CHECK (legal_basis IN ('consent', 'contract', 'legal_obligation',
    'vital_interests', 'public_task', 'legitimate_interests', 'recognised_legitimate_interests')),
  special_category_condition text CHECK (special_category_condition IN ('explicit_consent',
    'employment_and_social_protection', 'vital_interests', 'not_for_profit_body',
    'made_public_by_subject', 'legal_claims', 'substantial_public_interest',
    'health_and_social_care', 'public_health', 'archiving_research_statistics')),
  data_categories text[] NOT NULL DEFAULT '{}'
    CONSTRAINT processing_activity_data_categories_known CHECK (data_categories <@ ARRAY[
      'identity', 'contact', 'financial', 'location', 'online_identifiers', 'children',
      'criminal_offences', 'racial_or_ethnic_origin', 'political_opinions',
      'religious_or_philosophical_beliefs', 'trade_union_membership', 'genetic', 'biometric',
      'health', 'sex_life_or_orientation', 'other']::text[]),
  subject_categories text[] NOT NULL DEFAULT '{}'
    CONSTRAINT processing_activity_subject_categories_known CHECK (subject_categories <@ ARRAY[
      'applicants', 'grant_holders', 'beneficiaries', 'staff', 'volunteers', 'trustees', 'donors',
      'supporters', 'contacts', 'other']::text[]),
  recipients text NOT NULL DEFAULT '' CHECK (char_length(recipients) <= 2000)
    CONSTRAINT processing_activity_recipients_text CHECK (recipients !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  transfers_abroad text NOT NULL DEFAULT '' CHECK (char_length(transfers_abroad) <= 2000)
    CONSTRAINT processing_activity_transfers_abroad_text CHECK (transfers_abroad !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  retention text NOT NULL DEFAULT '' CHECK (char_length(retention) <= 1000)
    CONSTRAINT processing_activity_retention_text CHECK (retention !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  security_measures text NOT NULL DEFAULT '' CHECK (char_length(security_measures) <= 2000)
    CONSTRAINT processing_activity_security_measures_text CHECK (security_measures !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX processing_activity_name_unique
  ON privacy.processing_activity (tenant_id, lower(name)) WHERE archived_at IS NULL;
SELECT app.enable_tenant_rls('privacy.processing_activity');
SELECT app.deny_command('privacy.processing_activity', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON privacy.processing_activity
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON privacy.processing_activity
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_archived_at BEFORE UPDATE OF archived_at ON privacy.processing_activity
  FOR EACH ROW EXECUTE FUNCTION privacy.set_archived_at();
GRANT SELECT,
      INSERT (tenant_id, name, purpose, legal_basis, special_category_condition, data_categories,
              subject_categories, recipients, transfers_abroad, retention, security_measures,
              created_by, updated_by),
      UPDATE (name, purpose, legal_basis, special_category_condition, data_categories,
              subject_categories, recipients, transfers_abroad, retention, security_measures,
              archived_at, updated_by)
   ON privacy.processing_activity TO app_api;

-- A processor the tenant uses, where it is, and how a transfer abroad is
-- safeguarded. It is retired by archiving, never removed.
CREATE TABLE privacy.processor (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200)
    CONSTRAINT processor_name_text CHECK (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  service text NOT NULL CHECK (char_length(service) BETWEEN 1 AND 300)
    CONSTRAINT processor_service_text CHECK (service !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  contract_signed_on date,
  transfer_safeguard text CHECK (transfer_safeguard IN ('adequacy_regulations',
    'international_data_transfer_agreement', 'uk_addendum', 'binding_corporate_rules')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('privacy.processor');
SELECT app.deny_command('privacy.processor', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON privacy.processor
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON privacy.processor
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_archived_at BEFORE UPDATE OF archived_at ON privacy.processor
  FOR EACH ROW EXECUTE FUNCTION privacy.set_archived_at();
GRANT SELECT,
      INSERT (tenant_id, name, service, country_code, contract_signed_on, transfer_safeguard,
              created_by, updated_by),
      UPDATE (name, service, country_code, contract_signed_on, transfer_safeguard, archived_at,
              updated_by)
   ON privacy.processor TO app_api;

-- The processors an activity uses: a link is added or removed, never changed.
CREATE TABLE privacy.processing_activity_processor (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_activity_id uuid NOT NULL,
  processor_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, processing_activity_id, processor_id),
  FOREIGN KEY (tenant_id, processing_activity_id)
    REFERENCES privacy.processing_activity (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, processor_id) REFERENCES privacy.processor (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX processing_activity_processor_processor
  ON privacy.processing_activity_processor (tenant_id, processor_id);
SELECT app.enable_tenant_rls('privacy.processing_activity_processor');
SELECT app.deny_command('privacy.processing_activity_processor', 'UPDATE');
CREATE TRIGGER set_created_at BEFORE INSERT ON privacy.processing_activity_processor
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
GRANT SELECT, DELETE, INSERT (tenant_id, processing_activity_id, processor_id, created_by)
   ON privacy.processing_activity_processor TO app_api;

-- A data protection impact assessment (UK GDPR Article 35). Screening
-- answers are keyed by question id and each risk carries its own id (rule
-- 7). A new DPIA is a draft. Signing off sets the signer and review date,
-- and the database the time; a signed-off DPIA changes only by coming due
-- for review or being reopened, which clears its sign-off.
CREATE TABLE privacy.dpia (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200)
    CONSTRAINT dpia_title_text CHECK (title !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'signed_off', 'review_due')),
  screening jsonb NOT NULL DEFAULT '{}' CONSTRAINT dpia_screening_object
    CHECK (jsonb_typeof(screening) = 'object' AND octet_length(screening::text) <= 65536),
  risks jsonb NOT NULL DEFAULT '[]' CONSTRAINT dpia_risks_array
    CHECK (jsonb_typeof(risks) = 'array' AND octet_length(risks::text) <= 65536),
  dpo_advice text NOT NULL DEFAULT '' CHECK (char_length(dpo_advice) <= 10000)
    CONSTRAINT dpia_dpo_advice_text CHECK (dpo_advice !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  signed_off_by uuid,
  signed_off_at timestamptz,
  review_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CONSTRAINT dpia_sign_off CHECK (num_nulls(signed_off_by, signed_off_at, review_on) IN (0, 3)
    AND (status IN ('signed_off', 'review_due')) = (signed_off_by IS NOT NULL)),
  FOREIGN KEY (tenant_id, signed_off_by) REFERENCES app.membership (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('privacy.dpia');
SELECT app.deny_command('privacy.dpia', 'DELETE');

-- Only a signed-off DPIA comes due for review, one due for review is
-- reopened before it is signed off again, and nothing else about a
-- signed-off DPIA changes.
CREATE FUNCTION privacy.check_dpia()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF (OLD.status, NEW.status) IN (('draft', 'review_due'), ('in_review', 'review_due'),
                                  ('review_due', 'signed_off')) THEN
    RAISE EXCEPTION 'A DPIA cannot move from % to %.', OLD.status, NEW.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF OLD.status IN ('signed_off', 'review_due') AND NEW.status IN ('signed_off', 'review_due')
     AND (NEW.title, NEW.screening, NEW.risks, NEW.dpo_advice, NEW.signed_off_by, NEW.review_on)
         IS DISTINCT FROM
         (OLD.title, OLD.screening, OLD.risks, OLD.dpo_advice, OLD.signed_off_by, OLD.review_on)
  THEN
    RAISE EXCEPTION 'Reopen a signed-off DPIA to change it.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.signed_off_at := CASE WHEN NEW.status IN ('draft', 'in_review') THEN NULL
                            WHEN OLD.status <> 'signed_off' AND NEW.status = 'signed_off'
                              THEN pg_catalog.now()
                            ELSE OLD.signed_off_at END;
  RETURN NEW;
END
$function$;
CREATE TRIGGER set_created_at BEFORE INSERT ON privacy.dpia
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON privacy.dpia
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER check_dpia BEFORE UPDATE ON privacy.dpia
  FOR EACH ROW EXECUTE FUNCTION privacy.check_dpia();
GRANT SELECT,
      INSERT (tenant_id, title, screening, risks, dpo_advice, created_by, updated_by),
      UPDATE (title, status, screening, risks, dpo_advice, signed_off_by, review_on, updated_by)
   ON privacy.dpia TO app_api;

-- The processing activities a DPIA covers: a link is added or removed,
-- never changed, and only while the DPIA is not signed off.
CREATE TABLE privacy.dpia_processing_activity (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dpia_id uuid NOT NULL,
  processing_activity_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dpia_id, processing_activity_id),
  FOREIGN KEY (tenant_id, dpia_id) REFERENCES privacy.dpia (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, processing_activity_id)
    REFERENCES privacy.processing_activity (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX dpia_processing_activity_activity
  ON privacy.dpia_processing_activity (tenant_id, processing_activity_id);
SELECT app.enable_tenant_rls('privacy.dpia_processing_activity');
SELECT app.deny_command('privacy.dpia_processing_activity', 'UPDATE');

-- Reads the DPIA as the caller, and locks it against a concurrent sign-off.
CREATE FUNCTION privacy.refuse_signed_off_link()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  changed record;
  dpia_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN changed := OLD; ELSE changed := NEW; END IF;
  SELECT d.status INTO dpia_status
    FROM privacy.dpia d
   WHERE d.tenant_id = changed.tenant_id AND d.id = changed.dpia_id
     FOR SHARE;
  IF dpia_status IN ('signed_off', 'review_due') THEN
    RAISE EXCEPTION 'Reopen a signed-off DPIA to change the activities it covers.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN changed;
END
$function$;
CREATE TRIGGER set_created_at BEFORE INSERT ON privacy.dpia_processing_activity
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER refuse_signed_off_link BEFORE INSERT OR DELETE ON privacy.dpia_processing_activity
  FOR EACH ROW EXECUTE FUNCTION privacy.refuse_signed_off_link();
GRANT SELECT, DELETE, INSERT (tenant_id, dpia_id, processing_activity_id, created_by)
   ON privacy.dpia_processing_activity TO app_api;
