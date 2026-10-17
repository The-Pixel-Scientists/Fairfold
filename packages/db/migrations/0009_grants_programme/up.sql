-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0009, up: the grants schema's programme set-up (S04-02):
-- programmes, their rounds, each round's stages, each stage's rubric, and
-- each programme's outcome email templates, one version per row.
--
-- Every table is a tenant table under app.enable_tenant_rls(), with grants
-- to app_api alone, column by column. app_api may delete only stages and
-- criteria, and a foreign key refuses one that anything still refers to.
-- A template version never changes: a change is a new version, and a
-- release fixes the version it used (ADR 0020). Ids, created_at and
-- updated_at come from the database. Actors are memberships of the same
-- tenant, null where the operator or the system acted.
--
-- The lists, bounds and text rules copy the programme contracts in
-- modules/grants/src/contracts/programme (S04-01). Text is as line() and
-- paragraphs() leave it: no character that hides or reorders text (the
-- Cc, Cf, Zl and Zp categories, except a line break in paragraphs), and
-- nothing that JavaScript's trim() removes at either end. The two patterns
-- are written out in full for each column, and a test keeps every copy the
-- same and checks them against the contract's rules over every code point.

CREATE SCHEMA grants AUTHORIZATION migrator;
GRANT USAGE ON SCHEMA grants TO app_api;

CREATE TABLE grants.programme (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120)
    CONSTRAINT programme_title_text CHECK (title !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 300)
    CONSTRAINT programme_summary_text CHECK (summary !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000)
    CONSTRAINT programme_description_text CHECK (description !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.programme');
SELECT app.deny_command('grants.programme', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.programme
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, title, summary, description, status, created_by, updated_by),
      UPDATE (title, summary, description, status, updated_by)
   ON grants.programme TO app_api;

-- Opening and closing are instants; timezone is the zone they were entered
-- in, checked as app.tenant checks its zone. Money is in minor units of
-- GBP (ADR 0016), positive and at most 100,000,000,000. A round stays in
-- its programme, and its currency is fixed once set.
CREATE TABLE grants.round (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120)
    CONSTRAINT round_title_text CHECK (title !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  timezone text NOT NULL CHECK (timezone ~ '^[A-Za-z][A-Za-z0-9/_+-]{0,63}$'),
  budget_minor bigint NOT NULL CHECK (budget_minor BETWEEN 1 AND 100000000000),
  award_min_minor bigint NOT NULL CHECK (award_min_minor BETWEEN 1 AND 100000000000),
  award_max_minor bigint NOT NULL CHECK (award_max_minor BETWEEN 1 AND 100000000000),
  currency text NOT NULL DEFAULT 'GBP' CHECK (currency = 'GBP'),
  late_policy text NOT NULL CHECK (late_policy IN ('refuse', 'accept_and_flag')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  CONSTRAINT round_closes_after_opens CHECK (closes_at > opens_at),
  CONSTRAINT round_award_range CHECK (award_max_minor >= award_min_minor),
  CONSTRAINT round_budget_covers_award CHECK (budget_minor >= award_max_minor),
  FOREIGN KEY (tenant_id, programme_id) REFERENCES grants.programme (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX round_programme ON grants.round (tenant_id, programme_id);
SELECT app.enable_tenant_rls('grants.round');
SELECT app.deny_command('grants.round', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.round
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, programme_id, title, opens_at, closes_at, timezone, budget_minor,
              award_min_minor, award_max_minor, currency, late_policy, created_by, updated_by),
      UPDATE (title, opens_at, closes_at, timezone, budget_minor, award_min_minor,
              award_max_minor, late_policy, updated_by)
   ON grants.round TO app_api;

-- A round's stages in order, position counting from 1. Names (in any case)
-- and positions are unique in the round, checked at commit, so a reorder
-- or a swap of names saves in one transaction. A stage stays in its round,
-- and (tenant_id, round_id, id) lets later tables pin a stage of their own
-- round.
CREATE TABLE grants.stage (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60)
    CONSTRAINT stage_name_text CHECK (name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  position integer NOT NULL CHECK (position >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, round_id, id),
  CONSTRAINT stage_position_once UNIQUE (tenant_id, round_id, position)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT stage_name_once EXCLUDE USING btree
    (tenant_id WITH =, round_id WITH =, lower(name) WITH =) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id, round_id) REFERENCES grants.round (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.stage');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.stage
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, DELETE,
      INSERT (tenant_id, round_id, name, position, created_by, updated_by),
      UPDATE (name, position, updated_by)
   ON grants.stage TO app_api;

-- A criterion of a stage's rubric. Its id is what scores refer to, and
-- (tenant_id, stage_id, id) lets a score pin a criterion of its own stage.
-- A criterion stays in its stage; positions are unique in the stage,
-- checked at commit.
CREATE TABLE grants.rubric_criterion (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100)
    CONSTRAINT rubric_criterion_label_text CHECK (label !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  guidance text NOT NULL DEFAULT '' CHECK (char_length(guidance) <= 1000)
    CONSTRAINT rubric_criterion_guidance_text CHECK (guidance !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  weight integer NOT NULL CHECK (weight BETWEEN 1 AND 100),
  scale_min integer NOT NULL DEFAULT 1 CHECK (scale_min BETWEEN 0 AND 9),
  scale_max integer NOT NULL DEFAULT 5 CHECK (scale_max BETWEEN 1 AND 10),
  position integer NOT NULL CHECK (position >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, stage_id, id),
  CONSTRAINT rubric_criterion_position_once UNIQUE (tenant_id, stage_id, position)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT rubric_criterion_scale CHECK (scale_min < scale_max),
  FOREIGN KEY (tenant_id, stage_id) REFERENCES grants.stage (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.rubric_criterion');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.rubric_criterion
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, DELETE,
      INSERT (tenant_id, stage_id, label, guidance, weight, scale_min, scale_max, position,
              created_by, updated_by),
      UPDATE (label, guidance, weight, scale_min, scale_max, position, updated_by)
   ON grants.rubric_criterion TO app_api;

-- One version of a programme's email for an outcome, append-only: app_api
-- may insert and read, never change or remove. The merge fields are checked
-- by the API against the contract's allowlist.
CREATE TABLE grants.email_template_version (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'waitlisted', 'declined')),
  version integer NOT NULL CHECK (version >= 1),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 150)
    CONSTRAINT email_template_version_subject_text CHECK (subject !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000)
    CONSTRAINT email_template_version_body_text CHECK (body !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, programme_id, outcome, version),
  FOREIGN KEY (tenant_id, programme_id) REFERENCES grants.programme (tenant_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.email_template_version');
SELECT app.deny_command('grants.email_template_version', 'UPDATE');
SELECT app.deny_command('grants.email_template_version', 'DELETE');
GRANT SELECT,
      INSERT (tenant_id, programme_id, outcome, version, subject, body, created_by)
   ON grants.email_template_version TO app_api;
