-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0071, up: grants.public_open_rounds(slug), the approved definer
-- function behind browsing a tenant's open rounds before sign-in (S12-48,
-- ADR 0035, ADR 0019). It sets no tenant and resolves the tenant from the
-- slug inside itself. Its owner reads only the columns below, through one
-- SELECT policy per table that names it alone; every app role's policy is
-- unchanged. The columns it returns are the public fields of
-- modules/grants/src/contracts/public and nothing else. Reading public fields
-- is not a sensitive read, so it writes no audit event; the public route's
-- rate limit guards it.

-- An open round is the portal's: its programme is open, it has opened and not
-- closed, and it has a published form version. Rows only for an active
-- tenant whose grants module is on by an explicit row (ADR 0024), closing
-- soonest first, at most 100. The slug is compared exactly. Every not-found
-- case returns no rows and raises nothing: the definition is read in lax,
-- silent JSON path mode, so no stored shape can raise either.
--
-- The eligibility summary is the label and stop explanation of each
-- eligibility question in the round's latest published form version, in form
-- order, at most 50, capped at the form engine's lengths (ADR 0035). Nothing
-- else in the definition is read out.
CREATE FUNCTION grants.public_open_rounds(slug text)
  RETURNS TABLE (
    round_id uuid,
    programme_title text,
    programme_summary text,
    round_title text,
    opens_at timestamptz,
    closes_at timestamptz,
    timezone text,
    award_min_minor bigint,
    award_max_minor bigint,
    currency text,
    eligibility jsonb)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT r.id, p.title, p.summary, r.title, r.opens_at, r.closes_at, r.timezone,
         r.award_min_minor, r.award_max_minor, r.currency,
         COALESCE((
           SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'label', pg_catalog.left(e.field ->> 'label', 500),
                    'explanation',
                    pg_catalog.left(e.field -> 'eligibility' ->> 'explanation', 1000))
                    ORDER BY e.position)
             FROM pg_catalog.jsonb_path_query(f.definition,
                    'lax $.sections[*].fields[*] ? ((@.type == "single_choice" || @.type == "yes_no") && @.label.type() == "string" && @.label != "" && @.eligibility.explanation.type() == "string" && @.eligibility.explanation != "")',
                    '{}', true) WITH ORDINALITY AS e (field, position)
            WHERE e.position <= 50), '[]'::jsonb)
    FROM app.tenant AS t
    JOIN app.tenant_module AS m ON m.tenant_id = t.id
    JOIN grants.programme AS p ON p.tenant_id = t.id
    JOIN grants.round AS r ON r.tenant_id = p.tenant_id AND r.programme_id = p.id
   CROSS JOIN LATERAL (
     SELECT v.definition
       FROM grants.form_version AS v
      WHERE v.tenant_id = r.tenant_id AND v.round_id = r.id AND v.status = 'published'
      ORDER BY v.version DESC
      LIMIT 1) AS f
   WHERE t.slug = public_open_rounds.slug AND t.status = 'active'
     AND m.module = 'grants' AND m.enabled
     AND p.status = 'open'
     AND r.opens_at <= pg_catalog.now() AND r.closes_at > pg_catalog.now()
   ORDER BY r.closes_at, r.title, r.id
   LIMIT 100;
END;

GRANT USAGE ON SCHEMA app, grants TO owner_grants_public_open_rounds;
GRANT SELECT (id, slug, status) ON app.tenant TO owner_grants_public_open_rounds;
GRANT SELECT (tenant_id, module, enabled) ON app.tenant_module
   TO owner_grants_public_open_rounds;
GRANT SELECT (tenant_id, id, title, summary, status) ON grants.programme
   TO owner_grants_public_open_rounds;
GRANT SELECT (tenant_id, id, programme_id, title, opens_at, closes_at, timezone, award_min_minor,
              award_max_minor, currency)
   ON grants.round TO owner_grants_public_open_rounds;
GRANT SELECT (tenant_id, round_id, version, status, definition) ON grants.form_version
   TO owner_grants_public_open_rounds;
CREATE POLICY public_open_rounds_select ON app.tenant FOR SELECT
  TO owner_grants_public_open_rounds USING (true);
CREATE POLICY public_open_rounds_select ON app.tenant_module FOR SELECT
  TO owner_grants_public_open_rounds USING (true);
CREATE POLICY public_open_rounds_select ON grants.programme FOR SELECT
  TO owner_grants_public_open_rounds USING (true);
CREATE POLICY public_open_rounds_select ON grants.round FOR SELECT
  TO owner_grants_public_open_rounds USING (true);
CREATE POLICY public_open_rounds_select ON grants.form_version FOR SELECT
  TO owner_grants_public_open_rounds USING (true);

REVOKE ALL ON FUNCTION grants.public_open_rounds(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grants.public_open_rounds(text) TO app_api;
GRANT CREATE ON SCHEMA grants TO owner_grants_public_open_rounds;
ALTER FUNCTION grants.public_open_rounds(text) OWNER TO owner_grants_public_open_rounds;
REVOKE CREATE ON SCHEMA grants FROM owner_grants_public_open_rounds;
