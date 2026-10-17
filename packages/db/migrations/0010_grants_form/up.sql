-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0010, up: each round's application form, kept as numbered
-- versions (S05-02, architecture rule 7).
--
-- A round has at most one draft, which app_api may save, publish or
-- discard. A published version never changes: the UPDATE and DELETE
-- policies match drafts only, so to every role, migrator included, a
-- published row is not there to change or remove. app_api can add only
-- drafts, as it has no INSERT on status or the publication columns.
-- Applications pin a version of their own round through
-- (tenant_id, round_id, id); foreign key checks do not pass through
-- row-level security, so a published version can still be pinned. Ids,
-- created_at and updated_at come from the database; actors are memberships
-- of the same tenant.
--
-- The statuses and the size limit copy the form version contracts in
-- modules/grants/src/contracts/forms (S05-06). The contract allows 256 KB
-- of compact JSON; definition::text adds a space after each colon and
-- comma, so this backstop allows twice that. The API checks the definition
-- itself with the form engine. It is null only in a draft that started
-- empty and has not been saved yet.

CREATE TABLE grants.form_version (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  definition jsonb
    CONSTRAINT form_version_definition_object CHECK (jsonb_typeof(definition) = 'object')
    CONSTRAINT form_version_definition_size CHECK (octet_length(definition::text) <= 524288),
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, round_id, id),
  CONSTRAINT form_version_once UNIQUE (tenant_id, round_id, version),
  CONSTRAINT form_version_published CHECK (
    (status = 'published') = (published_at IS NOT NULL)
    AND (status = 'published') = (published_by IS NOT NULL)
    AND (status = 'draft' OR definition IS NOT NULL)),
  FOREIGN KEY (tenant_id, round_id) REFERENCES grants.round (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, published_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX form_version_one_draft ON grants.form_version (tenant_id, round_id)
  WHERE status = 'draft';
SELECT app.enable_tenant_rls('grants.form_version');
ALTER POLICY tenant_update ON grants.form_version
  USING (tenant_id = app.current_tenant_id() AND status = 'draft');
ALTER POLICY tenant_delete ON grants.form_version
  USING (tenant_id = app.current_tenant_id() AND status = 'draft');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.form_version
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, DELETE,
      INSERT (tenant_id, round_id, version, definition, created_by, updated_by),
      UPDATE (status, definition, published_at, published_by, updated_by)
   ON grants.form_version TO app_api;
