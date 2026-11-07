-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0019, up: an organisation's details as submitted (ADR 0017,
-- "Details as submitted"), and the application's key to them.
--
-- A snapshot is evidence: append-only, and copied by the database, never
-- written by the caller. app_api names the organisation and the member who
-- took it; the trigger sets everything else. Anonymising a snapshot on
-- erasure belongs to the erasure function (ADR 0027, S11-106), not to any
-- app role. (tenant_id, id) is the key party publishes to other modules
-- (ADR 0016), and (tenant_id, organisation_id, id) lets an application
-- reference only a snapshot of its own organisation.
CREATE TABLE party.organisation_snapshot (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
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
  address_country_code text NOT NULL CHECK (address_country_code ~ '^[A-Z]{2}$'),
  website text CHECK (
    char_length(website) <= 200 AND website ~ '^https://[^\s/?#@]+([/?#]\S*)?$'
    AND website !~ '[[:cntrl:]]'),
  identifiers jsonb NOT NULL,
  taken_by uuid NOT NULL,
  taken_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, organisation_id, id),
  CONSTRAINT organisation_snapshot_postcode CHECK (CASE
    WHEN address_country_code = 'GB'
      THEN address_postcode ~ '^([A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}|GIR 0AA)$'
    ELSE address_postcode ~ '^[A-Za-z0-9][A-Za-z0-9 -]*$' END),
  -- Each identifier is exactly { scheme, identifier, verifiedAt }, as the
  -- party contract's snapshot schema reads it, with the source's checks.
  CONSTRAINT organisation_snapshot_identifiers CHECK (
    jsonb_typeof(identifiers) = 'array'
    AND NOT jsonb_path_exists(identifiers, '$[*] ? (@.type() != "object"
      || !(@.scheme.type() == "string"
           && @.scheme like_regex "^(GB-CHC|GB-SC|GB-NIC|GB-COH|GB-MPR)$")
      || !(@.identifier.type() == "string" && @.identifier like_regex "^[A-Z0-9()]{1,30}$")
      || !(@.verifiedAt.type() == "null" || @.verifiedAt.type() == "string"
           && @.verifiedAt like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$"))')
    AND NOT jsonb_path_exists(identifiers, '$[*] ? (@.type() == "object").keyvalue()
      ? (@.key != "scheme" && @.key != "identifier" && @.key != "verifiedAt")')),
  FOREIGN KEY (tenant_id, organisation_id) REFERENCES party.organisation (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, taken_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('party.organisation_snapshot');
SELECT app.deny_command('party.organisation_snapshot', 'UPDATE');
SELECT app.deny_command('party.organisation_snapshot', 'DELETE');

-- Copy the organisation as the caller sees it now, in one statement so the
-- organisation and its identifiers come from one view of the data. The
-- tenant comes from the transaction; the reads run under the caller's
-- row-level security, so another tenant's organisation is never found.
-- Whatever the caller supplied for these columns is overwritten.
CREATE FUNCTION party.take_organisation_snapshot()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.tenant_id := app.current_tenant_id();
  NEW.taken_at := pg_catalog.now();
  SELECT o.name, o.legal_form, o.address_line1, o.address_line2, o.address_town,
         o.address_postcode, o.address_country_code, o.website,
         COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                     'scheme', i.scheme, 'identifier', i.identifier,
                     'verifiedAt', pg_catalog.to_char(i.verified_at AT TIME ZONE 'UTC',
                                                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
                     ORDER BY i.scheme, i.identifier)
                     FROM party.organisation_identifier i
                    WHERE i.tenant_id = o.tenant_id AND i.organisation_id = o.id),
                  '[]'::jsonb)
    INTO NEW.name, NEW.legal_form, NEW.address_line1, NEW.address_line2, NEW.address_town,
         NEW.address_postcode, NEW.address_country_code, NEW.website, NEW.identifiers
    FROM party.organisation o
   WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.organisation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A snapshot copies an organisation of the current tenant only.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER take_organisation_snapshot BEFORE INSERT ON party.organisation_snapshot
  FOR EACH ROW EXECUTE FUNCTION party.take_organisation_snapshot();

GRANT SELECT, INSERT (id, organisation_id, taken_by) ON party.organisation_snapshot TO app_api;

-- The application's snapshot, set at or after submission and then fixed.
-- The column has no default, so no row is rewritten, and every existing
-- application keeps a null snapshot (ADR 0017: MVP1 data is synthetic).
ALTER TABLE grants.application
  ADD COLUMN organisation_snapshot_id uuid,
  ADD CONSTRAINT application_snapshot_not_draft
    CHECK (status <> 'draft' OR organisation_snapshot_id IS NULL),
  ADD CONSTRAINT application_organisation_snapshot
    FOREIGN KEY (tenant_id, organisation_id, organisation_snapshot_id)
    REFERENCES party.organisation_snapshot (tenant_id, organisation_id, id) ON DELETE RESTRICT;

CREATE FUNCTION grants.keep_application_snapshot()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.organisation_snapshot_id IS NOT NULL
     AND NEW.organisation_snapshot_id IS DISTINCT FROM OLD.organisation_snapshot_id THEN
    RAISE EXCEPTION 'An application''s organisation snapshot never changes once set.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER keep_application_snapshot BEFORE UPDATE ON grants.application
  FOR EACH ROW EXECUTE FUNCTION grants.keep_application_snapshot();

GRANT UPDATE (organisation_snapshot_id) ON grants.application TO app_api;
