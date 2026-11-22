-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Run by load.sh as the tenant's warehouse owner, inside one transaction.
-- It refuses to run if the database holds a large object (provision.sql),
-- then drops every warehouse table. With the psql variables tenant, created
-- and model set from a snapshot's header, it then records that snapshot,
-- which must be at most 30 days old (ADR 0039); the snapshot's own tables
-- follow in the same transaction. The reader may select from every table
-- the owner creates here (provision.sql).

SET LOCAL search_path = warehouse;
SET LOCAL lock_timeout = '30s';

DO $drop$
DECLARE
  table_name text;
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_largeobject_metadata) THEN
    RAISE EXCEPTION 'The warehouse database holds large objects, which no load writes. Run provision.sh again to remove them.';
  END IF;
  FOR table_name IN SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'warehouse' LOOP
    EXECUTE format('DROP TABLE warehouse.%I', table_name);
  END LOOP;
END
$drop$;

\if :{?model}
CREATE TABLE _snapshot (
  tenant_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  model_version integer NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT snapshot_at_most_30_days_old CHECK (created_at > loaded_at - interval '30 days')
);
INSERT INTO _snapshot (tenant_id, created_at, model_version)
  VALUES (:'tenant', :'created', :'model');
\endif
