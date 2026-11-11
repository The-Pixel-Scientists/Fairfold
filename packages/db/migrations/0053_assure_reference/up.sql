-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0053, up: the assure schema (S12-14, ADR 0031), its time
-- stamping trigger, the module's queues, and the UK sanctions list as
-- platform reference data. Migrations 0054 to 0058 add the tenant tables.
-- Column names, lists and limits follow the assure contracts (S11-37).
--
-- Across the schema: every tenant table goes through
-- app.enable_tenant_rls(), and every reference to another tenant row is a
-- composite foreign key, ON DELETE RESTRICT. Files are linked through join
-- tables, as grants.application_file is (ADR 0030). No app role deletes an
-- assure row, but for the three join tables whose links staff replace, so
-- switching assure off keeps its data (ADR 0016). Times that record when
-- something happened are set by the database, whatever the caller sends.
-- Triggers read other tables as the caller, under its row-level security.
-- Nothing writes a decision, an audit event or an app.config_version row:
-- the servers write them with the member from the session (rules 4, 6 and
-- 9). Nothing writes to a party record.

CREATE SCHEMA assure AUTHORIZATION migrator;
REVOKE ALL ON SCHEMA assure FROM PUBLIC;
GRANT USAGE ON SCHEMA assure TO app_api, app_worker;

-- Sets each column named in the trigger's arguments to the database's time.
CREATE FUNCTION assure.stamp_now()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW := pg_catalog.jsonb_populate_record(NEW,
    (SELECT pg_catalog.jsonb_object_agg(c, pg_catalog.now()) FROM pg_catalog.unnest(TG_ARGV) AS c));
  RETURN NEW;
END
$function$;

-- Keeps an erased party's assure data final (ADR 0027, "erased is final"):
-- a row whose party, in the column named by the first argument, is erased
-- changes only to the erased values in the second, a jsonb object of
-- column and value, which are those assure.erase_subject writes. Any other
-- change, by any role, is refused. A change to erased values reads
-- nothing, so the erasure needs no right on party.is_erased.
CREATE FUNCTION assure.keep_erased()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  erased CONSTANT jsonb := TG_ARGV[1]::jsonb;
  new_row CONSTANT jsonb := pg_catalog.to_jsonb(NEW);
  old_row CONSTANT jsonb := pg_catalog.to_jsonb(OLD);
BEGIN
  IF NOT EXISTS (
       SELECT FROM pg_catalog.jsonb_each(new_row) AS n
        WHERE n.value IS DISTINCT FROM old_row -> n.key
          AND (NOT erased ? n.key OR n.value IS DISTINCT FROM erased -> n.key)) THEN
    RETURN NEW;
  END IF;
  IF party.is_erased(OLD.tenant_id, (old_row ->> TG_ARGV[0])::uuid) THEN
    RAISE EXCEPTION 'An erased party''s data never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;

-- Reference lists (ADR 0031, "Reference lists"): public data, the same for
-- every tenant, held once per deployment. These are ADR 0031's named
-- exception to rule 2: no tenant_id, and app_api and app_worker read them
-- only. No app role writes them; ADR 0031's loader function and its own
-- owner role come with the list download (S12-26).
CREATE TABLE assure.reference_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('uk_sanctions_list', 'oscr_register', 'ccni_register')),
  published_on date NOT NULL,
  downloaded_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  row_count integer NOT NULL CHECK (row_count >= 0),
  superseded_at timestamptz,
  CONSTRAINT reference_list_checked CHECK (last_checked_at >= downloaded_at),
  CONSTRAINT reference_list_superseded CHECK (superseded_at >= downloaded_at)
);
CREATE UNIQUE INDEX reference_list_current ON assure.reference_list (source)
  WHERE superseded_at IS NULL;

-- One row per name or alias of a designation, as published. Only the
-- identifying details the list publishes, and for individuals only: never
-- the statement of reasons or other free text (no Article 10 data beyond
-- the list), and no PEP or adverse-media data. superseded_at copies its
-- list's, so the rows go 90 days after it.
CREATE TABLE assure.sanctions_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES assure.reference_list (id) ON DELETE RESTRICT,
  designation_id text NOT NULL CHECK (designation_id ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{0,39}$'),
  entry_kind text NOT NULL CHECK (entry_kind IN ('individual', 'entity', 'ship')),
  name_type text NOT NULL CHECK (name_type IN ('primary', 'alias')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300 AND name !~ '[[:cntrl:]]'),
  normalised_name text NOT NULL
    CHECK (char_length(normalised_name) BETWEEN 1 AND 300 AND normalised_name !~ '[[:cntrl:]]'),
  regime text NOT NULL CHECK (char_length(regime) BETWEEN 1 AND 200 AND regime !~ '[[:cntrl:]]'),
  designated_on date,
  dates_of_birth text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(dates_of_birth) <= 20 AND array_position(dates_of_birth, NULL) IS NULL
    AND array_to_string(dates_of_birth, ',') ~ '^([0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?(,|$))*$'),
  nationalities text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(nationalities) <= 20 AND array_position(nationalities, NULL) IS NULL
    AND char_length(array_to_string(nationalities, '')) <= 2000
    AND array_to_string(nationalities, '') !~ '[[:cntrl:]]'),
  country text CHECK (char_length(country) BETWEEN 1 AND 100 AND country !~ '[[:cntrl:]]'),
  superseded_at timestamptz,
  CONSTRAINT sanctions_entry_individual_details CHECK (entry_kind = 'individual'
    OR (dates_of_birth = '{}' AND nationalities = '{}' AND country IS NULL))
);
CREATE INDEX sanctions_entry_designation ON assure.sanctions_entry (list_id, designation_id);
CREATE INDEX sanctions_entry_normalised_name_trgm
  ON assure.sanctions_entry USING gin (normalised_name ext.gin_trgm_ops);

ALTER TABLE assure.reference_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE assure.reference_list FORCE ROW LEVEL SECURITY;
CREATE POLICY reader_select ON assure.reference_list FOR SELECT TO app_api, app_worker
  USING (true);
ALTER TABLE assure.sanctions_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE assure.sanctions_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY reader_select ON assure.sanctions_entry FOR SELECT TO app_api, app_worker
  USING (true);
SELECT app.deny_command(t, c)
  FROM unnest(ARRAY['assure.reference_list', 'assure.sanctions_entry']::regclass[]) AS t,
       unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS c;

GRANT SELECT ON assure.reference_list, assure.sanctions_entry TO app_api, app_worker;

-- The module's queues (ADR 0009). The list download is one job for the
-- deployment, as the list is.
DO $$
DECLARE
  queue record;
BEGIN
  FOR queue IN SELECT * FROM (VALUES
      ('assure.registry_refresh', 'tenant'),
      ('assure.screening', 'tenant'),
      ('assure.sanctions_list_refresh', 'platform')) AS q(name, kind)
  LOOP
    PERFORM pgboss.create_queue(queue.name || '.dead', '{"policy": "standard"}');
    PERFORM pgboss.create_queue(queue.name,
      jsonb_build_object('policy', 'standard', 'deadLetter', queue.name || '.dead'));
    INSERT INTO app.job_queue (name, kind)
      VALUES (queue.name || '.dead', queue.kind), (queue.name, queue.kind);
  END LOOP;
END
$$;
