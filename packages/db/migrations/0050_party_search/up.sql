-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0050, up: trigram indexes and generated tsvector columns on the
-- party tables (ADR 0025, S12-04). No table, role, grant, policy or function
-- is added; every query still runs under the tables' row-level security.
--
-- No app role can use these seven indexes. The pg_trgm and full-text operators
-- are not LEAKPROOF and row-level security is forced, so PostgreSQL applies the
-- tenant policy first and then tests the search condition on every row in the
-- tenant (test/party-search/plan.test.ts pins this). Nothing is to be marked
-- LEAKPROOF. As app_api, a ranked trigram search limited to 20 rows had a p95
-- of 131 ms on email at 10,000 people in the tenant and 525 ms at 50,000, over
-- the 500 ms target; the other trigram columns stayed at or under 80 ms at
-- 50,000 people or 15,000 organisations. The indexes are built because S12-04
-- specifies them. Today they add write cost and further copies of the indexed
-- values, and give searches no speed.
--
-- For a self-hoster with a large table: this migration builds the indexes
-- inside its transaction, and each stored generated column rewrites its table
-- under an exclusive lock. To shorten that lock, not to speed up searches,
-- build the five trigram indexes below with CREATE INDEX CONCURRENTLY under
-- exactly these names before upgrading; IF NOT EXISTS then skips them here.
-- The two tsvector indexes need their column first, so they are built here,
-- after the rewrite.

CREATE INDEX IF NOT EXISTS organisation_name_trgm
  ON party.organisation USING gin (name ext.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS organisation_identifier_identifier_trgm
  ON party.organisation_identifier USING gin (identifier ext.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS person_given_name_trgm
  ON party.person USING gin (given_name ext.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS person_family_name_trgm
  ON party.person USING gin (family_name ext.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS person_email_trgm
  ON party.person USING gin (email ext.gin_trgm_ops);

-- The simple configuration, named so the expression is immutable: stemming
-- harms names and Welsh (ADR 0025), and no unaccent is used.
ALTER TABLE party.organisation
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, name)) STORED;

-- An erased person keeps a placeholder email (migration 0033), which is left
-- out so that nothing about them can be found through this column.
ALTER TABLE party.person
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
      COALESCE(given_name, '') || ' ' || COALESCE(family_name, '') || ' '
        || CASE WHEN email LIKE '%@erased.invalid' THEN '' ELSE email END)) STORED;

CREATE INDEX organisation_search_vector
  ON party.organisation USING gin (search_vector);
CREATE INDEX person_search_vector
  ON party.person USING gin (search_vector);
