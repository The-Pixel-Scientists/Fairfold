-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0100, up: document template versions (ADR 0040, S12-62).
--
-- A template is configuration (rule 10). Each publish inserts one version,
-- which no app role may change or remove: a change is a new version, and the
-- server records its config_version row through ctx.config.record under the
-- platform.document_template entity type. A generated document pins the
-- version it was made from by a real foreign key. The lists and limits copy
-- documentKinds, projectionAudiences, fieldIdSchema and the MAX_ limits in
-- packages/domain/src/documents/templates.ts, and a test keeps them in step.
-- Whether each merge field is one the template's audience may see is
-- checked by checkTemplateFields() in the server (S12-78), since field
-- definitions live in pinned form versions; nothing here repeats that rule.
-- The body is the contract's structured blocks, never code or HTML; its cap
-- here is a backstop at twice the contract's 200,000 characters, since
-- PostgreSQL's text form of jsonb adds a space after each colon and comma.

CREATE TABLE app.document_template_version (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  kind text NOT NULL CHECK (kind IN ('board_pack', 'agreement')),
  audience text NOT NULL
    CHECK (audience IN ('applicant', 'staff', 'reviewer', 'blind_reviewer', 'respondent')),
  -- No control or format character, as the contract's plain text.
  title text NOT NULL
    CONSTRAINT document_template_version_title_length CHECK (char_length(title) BETWEEN 1 AND 200)
    CONSTRAINT document_template_version_title_text CHECK (title !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'),
  merge_fields text[] NOT NULL
    CONSTRAINT document_template_version_merge_fields CHECK (
      cardinality(merge_fields) <= 200
      AND COALESCE(array_ndims(merge_fields), 1) = 1
      AND array_to_string(merge_fields, ' ', '*') ~ '^(f_[a-z0-9]{1,32}( f_[a-z0-9]{1,32})*)?$'),
  body jsonb NOT NULL
    CONSTRAINT document_template_version_body CHECK (CASE WHEN jsonb_typeof(body) = 'array'
      THEN jsonb_array_length(body) BETWEEN 1 AND 500 AND char_length(body::text) <= 400000
      ELSE false END),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, template_id, version),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.document_template_version');
SELECT app.deny_command('app.document_template_version', 'UPDATE');
SELECT app.deny_command('app.document_template_version', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON app.document_template_version
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();

-- The API publishes; the worker reads a version to render a document.
GRANT SELECT,
      INSERT (tenant_id, id, template_id, version, kind, audience, title, merge_fields, body,
              created_by)
   ON app.document_template_version TO app_api;
GRANT SELECT ON app.document_template_version TO app_worker;
