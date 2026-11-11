-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0054, up: register lookup snapshots and their officers
-- (S12-14, ADR 0031). The refresh job writes both (S12-17); app_api reads
-- them and links an officer to a person.

-- A register's entry for one identifier, copied by the worker (S12-17). A
-- refresh writes a new row; the newest per organisation and register is the
-- current one. Structured columns only, never a raw response. Nothing here
-- verifies or links an identifier: verification is a party action that
-- cites the snapshot (ADR 0017).
CREATE TABLE assure.lookup_snapshot (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  registry text NOT NULL
    CHECK (registry IN ('charity_commission', 'companies_house', 'oscr', 'ccni')),
  scheme text NOT NULL,
  identifier text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('found', 'not_found')),
  list_id uuid REFERENCES assure.reference_list (id) ON DELETE RESTRICT,
  registry_status text CHECK (registry_status IN
    ('registered', 'removed', 'active', 'dissolved', 'in_liquidation', 'other')),
  registered_name text
    CHECK (char_length(registered_name) BETWEEN 1 AND 300 AND registered_name !~ '[[:cntrl:]]'),
  address_line1 text
    CHECK (char_length(address_line1) BETWEEN 1 AND 200 AND address_line1 !~ '[[:cntrl:]]'),
  address_line2 text
    CHECK (char_length(address_line2) BETWEEN 1 AND 200 AND address_line2 !~ '[[:cntrl:]]'),
  address_town text
    CHECK (char_length(address_town) BETWEEN 1 AND 100 AND address_town !~ '[[:cntrl:]]'),
  address_postcode text
    CHECK (char_length(address_postcode) BETWEEN 1 AND 16 AND address_postcode !~ '[[:cntrl:]]'),
  address_country_code text CHECK (address_country_code ~ '^[A-Z]{2}$'),
  registered_on date,
  removed_on date,
  accounts_period_end date,
  income_minor bigint CHECK (income_minor >= 0),
  income_currency char(3) CHECK (income_currency ~ '^[A-Z]{3}$'),
  expenditure_minor bigint CHECK (expenditure_minor >= 0),
  expenditure_currency char(3) CHECK (expenditure_currency ~ '^[A-Z]{3}$'),
  accounts_overdue boolean,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, organisation_id)
    REFERENCES party.organisation (tenant_id, id) ON DELETE RESTRICT,
  -- Each register serves one party scheme, in its format (party contracts).
  CONSTRAINT lookup_snapshot_identifier CHECK (CASE registry
    WHEN 'charity_commission' THEN scheme = 'GB-CHC' AND identifier ~ '^([1-9][0-9]{5}|1[0-9]{6})$'
    WHEN 'companies_house' THEN scheme = 'GB-COH'
      AND identifier ~ '^([0-9]{8}|[A-Z]{2}[0-9]{6}|R[0-9]{7})$'
    WHEN 'oscr' THEN scheme = 'GB-SC' AND identifier ~ '^SC[0-9]{6}$'
    WHEN 'ccni' THEN scheme = 'GB-NIC' AND identifier ~ '^1[0-9]{5}$'
  END),
  -- OSCR and CCNI lookups read a register download; the others call out.
  CONSTRAINT lookup_snapshot_list CHECK ((list_id IS NOT NULL) = (registry IN ('oscr', 'ccni'))),
  CONSTRAINT lookup_snapshot_outcome CHECK (CASE outcome
    WHEN 'found' THEN registry_status IS NOT NULL AND registered_name IS NOT NULL
    ELSE num_nonnulls(registry_status, registered_name, address_line1, address_line2,
      address_town, address_postcode, address_country_code, registered_on, removed_on,
      accounts_period_end, income_minor, income_currency, expenditure_minor,
      expenditure_currency, accounts_overdue) = 0
  END),
  CONSTRAINT lookup_snapshot_address CHECK (
    num_nulls(address_line1, address_town, address_postcode, address_country_code) IN (0, 4)
    AND (address_line2 IS NULL OR address_line1 IS NOT NULL)),
  -- Money in minor units with its currency, both or neither (D18).
  CONSTRAINT lookup_snapshot_accounts CHECK (
    (income_minor IS NULL) = (income_currency IS NULL)
    AND (expenditure_minor IS NULL) = (expenditure_currency IS NULL)
    AND (accounts_period_end IS NOT NULL OR num_nonnulls(income_minor, expenditure_minor) = 0)),
  CONSTRAINT lookup_snapshot_overdue
    CHECK (accounts_overdue IS NULL OR registry = 'companies_house')
);
CREATE INDEX lookup_snapshot_latest
  ON assure.lookup_snapshot (tenant_id, organisation_id, registry, fetched_at DESC);
SELECT app.enable_tenant_rls('assure.lookup_snapshot');
SELECT app.deny_command('assure.lookup_snapshot', 'UPDATE');
SELECT app.deny_command('assure.lookup_snapshot', 'DELETE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.lookup_snapshot
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('fetched_at');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF organisation_id
  ON assure.lookup_snapshot
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('organisation_id');
CREATE TRIGGER keep_erased
  BEFORE UPDATE OF address_line1, address_line2, address_town, address_postcode,
    address_country_code
  ON assure.lookup_snapshot
  FOR EACH ROW EXECUTE FUNCTION assure.keep_erased('organisation_id',
    '{"address_line1": null, "address_line2": null, "address_town": null,
      "address_postcode": null, "address_country_code": null}');

-- A snapshot's current officers, trustees and persons with significant
-- control, by name and role only (ADR 0031). person_id is set once, by the
-- named staff action that links the row to the person it is, and never by
-- a lookup, screening run or name comparison.
CREATE TABLE assure.lookup_officer (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200 AND name !~ '[[:cntrl:]]'),
  role text NOT NULL CHECK (role IN
    ('trustee', 'director', 'secretary', 'person_with_significant_control', 'other')),
  person_id uuid,
  linked_by uuid,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT lookup_officer_link CHECK (num_nulls(person_id, linked_by, linked_at) IN (0, 3)),
  FOREIGN KEY (tenant_id, snapshot_id)
    REFERENCES assure.lookup_snapshot (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, person_id) REFERENCES party.person (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, linked_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX lookup_officer_snapshot ON assure.lookup_officer (tenant_id, snapshot_id);
CREATE INDEX lookup_officer_person ON assure.lookup_officer (tenant_id, person_id);
SELECT app.enable_tenant_rls('assure.lookup_officer');
SELECT app.deny_command('assure.lookup_officer', 'DELETE');
CREATE TRIGGER stamp_now BEFORE INSERT ON assure.lookup_officer
  FOR EACH ROW EXECUTE FUNCTION assure.stamp_now('created_at');
CREATE TRIGGER refuse_erased_party BEFORE INSERT OR UPDATE OF person_id ON assure.lookup_officer
  FOR EACH ROW EXECUTE FUNCTION party.refuse_erased_party('person_id');
CREATE TRIGGER keep_erased BEFORE UPDATE OF name ON assure.lookup_officer
  FOR EACH ROW EXECUTE FUNCTION assure.keep_erased('person_id', '{"name": "erased"}');

-- An officer is linked once, and the link is the database's time.
CREATE FUNCTION assure.link_officer_once()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.person_id IS NOT NULL THEN
      RAISE EXCEPTION 'An officer is linked to a person only by a member, after it is added.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (NEW.person_id, NEW.linked_by) IS DISTINCT FROM (OLD.person_id, OLD.linked_by) THEN
    IF OLD.person_id IS NOT NULL THEN
      RAISE EXCEPTION 'An officer is linked to a person once.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    NEW.linked_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER link_officer_once BEFORE INSERT OR UPDATE ON assure.lookup_officer
  FOR EACH ROW EXECUTE FUNCTION assure.link_officer_once();

GRANT SELECT ON assure.lookup_snapshot TO app_api;
GRANT SELECT, UPDATE (person_id, linked_by) ON assure.lookup_officer TO app_api;
GRANT SELECT,
      INSERT (tenant_id, organisation_id, registry, scheme, identifier, outcome, list_id,
              registry_status, registered_name, address_line1, address_line2, address_town,
              address_postcode, address_country_code, registered_on, removed_on,
              accounts_period_end, income_minor, income_currency, expenditure_minor,
              expenditure_currency, accounts_overdue)
   ON assure.lookup_snapshot TO app_worker;
GRANT SELECT, INSERT (tenant_id, snapshot_id, name, role) ON assure.lookup_officer TO app_worker;
