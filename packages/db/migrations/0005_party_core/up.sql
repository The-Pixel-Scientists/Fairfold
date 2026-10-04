-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0005, up: the party core (ADR 0017): parties, organisations and
-- their identifiers, people, the relationships between them, and consent.
--
-- Every table is a tenant table under app.enable_tenant_rls(). Grants go to
-- app_api alone, column by column. No app role may delete from any party
-- table, since erasure anonymises in place, and consent is append-only.
-- Ids, created_at and updated_at come from the database, except that an
-- organisation or person takes its party's id. Actors are memberships of the
-- same tenant, null where the operator or the system acted. The checked
-- lists copy those in modules/party/src/contracts (S03-01).

CREATE SCHEMA party AUTHORIZATION migrator;
GRANT USAGE ON SCHEMA party TO app_api;

-- The key other modules reference. (tenant_id, id, kind) is unique so that
-- each reference can fix the kind it accepts. Every other party table
-- reaches app.tenant through a composite key to this one.
CREATE TABLE party.party (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('organisation', 'person')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, kind),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('party.party');
SELECT app.deny_command('party.party', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON party.party
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, kind, created_by, updated_by),
      UPDATE (status, updated_by)
   ON party.party TO app_api;

-- One row per organisation party. Text is trimmed and free of control
-- characters. A GB postcode is in its normal form (SW1A 1AA).
CREATE TABLE party.organisation (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  kind text NOT NULL DEFAULT 'organisation' CHECK (kind = 'organisation'),
  name text NOT NULL CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 200 AND name !~ '[[:cntrl:]]'),
  legal_form text NOT NULL CHECK (legal_form IN (
    'registered_charity', 'charitable_incorporated_organisation', 'company_limited_by_guarantee',
    'community_interest_company', 'community_benefit_society', 'unincorporated_group',
    'public_body', 'other')),
  address_line1 text NOT NULL CHECK (
    address_line1 = btrim(address_line1) AND char_length(address_line1) BETWEEN 1 AND 100
    AND address_line1 !~ '[[:cntrl:]]'),
  address_line2 text CHECK (
    address_line2 = btrim(address_line2) AND char_length(address_line2) BETWEEN 1 AND 100
    AND address_line2 !~ '[[:cntrl:]]'),
  address_town text NOT NULL CHECK (
    address_town = btrim(address_town) AND char_length(address_town) BETWEEN 1 AND 60
    AND address_town !~ '[[:cntrl:]]'),
  address_postcode text NOT NULL CHECK (char_length(address_postcode) <= 12),
  address_country_code text NOT NULL DEFAULT 'GB' CHECK (address_country_code ~ '^[A-Z]{2}$'),
  website text CHECK (
    char_length(website) <= 200 AND website ~ '^https://[^\s/?#@]+([/?#]\S*)?$'
    AND website !~ '[[:cntrl:]]'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  CONSTRAINT organisation_postcode CHECK (CASE
    WHEN address_country_code = 'GB'
      THEN address_postcode ~ '^([A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}|GIR 0AA)$'
    ELSE address_postcode ~ '^[A-Za-z0-9][A-Za-z0-9 -]*$' END),
  FOREIGN KEY (tenant_id, id, kind) REFERENCES party.party (tenant_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('party.organisation');
SELECT app.deny_command('party.organisation', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON party.organisation
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, id, name, legal_form, address_line1, address_line2, address_town,
              address_postcode, address_country_code, website, created_by, updated_by),
      UPDATE (name, legal_form, address_line1, address_line2, address_town, address_postcode,
              address_country_code, website, updated_by)
   ON party.organisation TO app_api;

-- An org-id.guide identifier, as its register writes it. Until staff verify
-- it, it is a claim, so two organisations may claim the same one; once
-- verified it is unique in the tenant. Staff verification comes after MVP1,
-- so no app role may write verified_at or verified_by yet.
CREATE TABLE party.organisation_identifier (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  scheme text NOT NULL CHECK (scheme IN ('GB-CHC', 'GB-SC', 'GB-NIC', 'GB-COH', 'GB-MPR')),
  identifier text NOT NULL CHECK (identifier ~ '^[A-Z0-9()]{1,30}$'),
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, organisation_id, scheme),
  CONSTRAINT organisation_identifier_verified CHECK ((verified_at IS NULL) = (verified_by IS NULL)),
  FOREIGN KEY (tenant_id, organisation_id) REFERENCES party.organisation (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, verified_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX organisation_identifier_verified_once
  ON party.organisation_identifier (tenant_id, scheme, identifier) WHERE verified_at IS NOT NULL;
SELECT app.enable_tenant_rls('party.organisation_identifier');
SELECT app.deny_command('party.organisation_identifier', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON party.organisation_identifier
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- A changed identifier is a new claim, so it loses any verification: a
-- contact cannot turn a verified number into another one.
CREATE FUNCTION party.unverify_changed_identifier()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.identifier IS DISTINCT FROM OLD.identifier THEN
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER unverify_changed_identifier BEFORE UPDATE ON party.organisation_identifier
  FOR EACH ROW EXECUTE FUNCTION party.unverify_changed_identifier();
GRANT SELECT,
      INSERT (tenant_id, organisation_id, scheme, identifier, created_by, updated_by),
      UPDATE (identifier, updated_by)
   ON party.organisation_identifier TO app_api;

-- One row per person party. Names stay empty until the person completes
-- their profile. user_id is the account that is this person, set only from
-- the session, and is fixed once set.
CREATE TABLE party.person (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  kind text NOT NULL DEFAULT 'person' CHECK (kind = 'person'),
  given_name text CHECK (
    given_name = btrim(given_name) AND char_length(given_name) BETWEEN 1 AND 100
    AND given_name !~ '[[:cntrl:]]'),
  family_name text CHECK (
    family_name = btrim(family_name) AND char_length(family_name) BETWEEN 1 AND 100
    AND family_name !~ '[[:cntrl:]]'),
  email text NOT NULL CHECK (
    email = lower(btrim(email)) AND char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  phone text CHECK (
    char_length(phone) <= 25 AND phone ~ '^\+?[0-9 ()-]+$'
    AND char_length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 10 AND 15),
  user_id uuid REFERENCES auth."user" (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id, id, kind) REFERENCES party.party (tenant_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('party.person');
SELECT app.deny_command('party.person', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON party.person
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, id, given_name, family_name, email, phone, user_id, created_by,
              updated_by),
      UPDATE (given_name, family_name, phone, updated_by)
   ON party.person TO app_api;

-- A typed link from a subject party to an object party, carrying the kind
-- at each end so a check can tie each type to the kinds it joins. A link is
-- current until it has an end date, and two parties have at most one
-- current link of each type.
CREATE TABLE party.relationship (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('contact_for')),
  subject_id uuid NOT NULL,
  subject_kind text NOT NULL,
  object_id uuid NOT NULL,
  object_kind text NOT NULL,
  starts_on date,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  CONSTRAINT relationship_kinds CHECK (
    type = 'contact_for' AND subject_kind = 'person' AND object_kind = 'organisation'),
  CONSTRAINT relationship_distinct_parties CHECK (subject_id <> object_id),
  CONSTRAINT relationship_dates CHECK (ends_on >= starts_on),
  FOREIGN KEY (tenant_id, subject_id, subject_kind) REFERENCES party.party (tenant_id, id, kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, object_id, object_kind) REFERENCES party.party (tenant_id, id, kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX relationship_current_once
  ON party.relationship (tenant_id, type, subject_id, object_id) WHERE ends_on IS NULL;
CREATE INDEX relationship_object ON party.relationship (tenant_id, object_id);
SELECT app.enable_tenant_rls('party.relationship');
SELECT app.deny_command('party.relationship', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON party.relationship
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, type, subject_id, subject_kind, object_id, object_kind, starts_on,
              ends_on, created_by, updated_by),
      UPDATE (starts_on, ends_on, updated_by)
   ON party.relationship TO app_api;

-- One row per consent change, append-only: the current state for a purpose
-- and channel is the person's latest row. The person reference reaches
-- party.person, so it can only be a person. recorded_at uses the clock
-- rather than the transaction's start, so two changes in one transaction
-- keep their order. A person or a member of staff always records it.
CREATE TABLE party.consent (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('future_funding')),
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'phone', 'post')),
  state text NOT NULL CHECK (state IN ('given', 'withdrawn')),
  privacy_notice_version text NOT NULL
    CHECK (privacy_notice_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  source text NOT NULL CHECK (source IN ('portal', 'staff')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX consent_latest
  ON party.consent (tenant_id, person_id, purpose, channel, recorded_at DESC);
SELECT app.enable_tenant_rls('party.consent');
SELECT app.deny_command('party.consent', 'UPDATE');
SELECT app.deny_command('party.consent', 'DELETE');
GRANT SELECT,
      INSERT (tenant_id, person_id, purpose, channel, state, privacy_notice_version, source,
              recorded_by)
   ON party.consent TO app_api;
