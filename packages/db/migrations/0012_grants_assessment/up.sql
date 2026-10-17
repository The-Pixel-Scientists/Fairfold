-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0012, up: assessment (S08-01): each round's reviewer pool, the
-- pool's assignments to the round's applications at its stages, conflicts
-- declared on them, and scores against each stage's rubric.
--
-- Every table is a tenant table under app.enable_tenant_rls(), with grants
-- to app_api alone, column by column, and a restrictive policy for each
-- command no app role is granted. Keys are composite with tenant_id and
-- ON DELETE RESTRICT, and carry the round or the stage with them, so no row
-- pairs a reviewer from outside the round's pool, an application or stage
-- of another round, or a criterion of another stage. Ids and times come
-- from the database; actors are memberships of the same tenant.
--
-- The statuses copy modules/grants/src/contracts/assessment/lists.ts, and a
-- score's bounds and comment rules copy scores.ts there (S08-04). The API
-- checks each score against its criterion's scale.

-- A member in a round's reviewer pool. Removing one deletes the row, which
-- the assignments' key refuses while the reviewer has any.
CREATE TABLE grants.reviewer (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, round_id, membership_id),
  FOREIGN KEY (tenant_id, round_id) REFERENCES grants.round (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, membership_id) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, added_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.reviewer');
SELECT app.deny_command('grants.reviewer', 'UPDATE');
GRANT SELECT, DELETE,
      INSERT (tenant_id, round_id, membership_id, added_by)
   ON grants.reviewer TO app_api;

-- A pool reviewer's assignment to an application of the round, at one of
-- the round's stages, once per application, reviewer and stage. It starts
-- assigned and ends either submitted, with its scores fixed, or conflicted,
-- when the reviewer declares a conflict; neither changes again. The trigger
-- sets submitted_at, exactly when it is submitted. Only an assigned one is
-- deleted, and a score's key refuses that once it has any. (tenant_id, id,
-- stage_id) lets a score pin a criterion of the assignment's own stage, and
-- (tenant_id, id, reviewer_membership_id) lets a declaration pin its
-- reviewer.
CREATE TABLE grants.assignment (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  application_id uuid NOT NULL,
  reviewer_membership_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'submitted', 'conflicted')),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, stage_id),
  UNIQUE (tenant_id, id, reviewer_membership_id),
  CONSTRAINT assignment_once UNIQUE (tenant_id, application_id, reviewer_membership_id, stage_id),
  CONSTRAINT assignment_submitted_at CHECK ((status = 'submitted') = (submitted_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, round_id, application_id)
    REFERENCES grants.application (tenant_id, round_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, round_id, reviewer_membership_id)
    REFERENCES grants.reviewer (tenant_id, round_id, membership_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, round_id, stage_id)
    REFERENCES grants.stage (tenant_id, round_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX assignment_reviewer
  ON grants.assignment (tenant_id, reviewer_membership_id, round_id);
SELECT app.enable_tenant_rls('grants.assignment');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.assignment
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Whoever makes the change: an assigned assignment is submitted, declared
-- conflicted or deleted, and a submitted or conflicted one never changes.
-- The submission time is the transaction's, whatever the caller sent.
CREATE FUNCTION grants.check_assignment_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.status <> 'assigned' THEN
    RAISE EXCEPTION 'A submitted or conflicted assignment never changes.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status = 'submitted' THEN
    NEW.submitted_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER check_assignment_change BEFORE UPDATE OR DELETE ON grants.assignment
  FOR EACH ROW EXECUTE FUNCTION grants.check_assignment_change();

GRANT SELECT, DELETE,
      INSERT (tenant_id, round_id, application_id, reviewer_membership_id, stage_id,
              created_by, updated_by),
      UPDATE (status, updated_by)
   ON grants.assignment TO app_api;

-- The assigned reviewer's declaration of a conflict of interest, one per
-- assignment, append-only. Its key makes the declarer the assignment's
-- reviewer, and it keeps the assignment. The API marks the assignment
-- conflicted first, in the same transaction, and the trigger checks that.
CREATE TABLE grants.conflict_declaration (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  declared_at timestamptz NOT NULL DEFAULT now(),
  declared_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, assignment_id),
  FOREIGN KEY (tenant_id, assignment_id, declared_by)
    REFERENCES grants.assignment (tenant_id, id, reviewer_membership_id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.conflict_declaration');
SELECT app.deny_command('grants.conflict_declaration', 'UPDATE');
SELECT app.deny_command('grants.conflict_declaration', 'DELETE');

-- A conflicted assignment never changes, so the check needs no lock. Like
-- the checks in migration 0011, it runs after the row-level security
-- checks and foreign keys, and its read runs under the caller's row-level
-- security.
CREATE FUNCTION grants.check_conflict_declaration()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM FROM grants.assignment a
    WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.assignment_id AND a.status = 'conflicted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A conflict is declared only on an assignment marked conflicted.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER check_conflict_declaration AFTER INSERT ON grants.conflict_declaration
  FOR EACH ROW EXECUTE FUNCTION grants.check_conflict_declaration();

GRANT SELECT,
      INSERT (tenant_id, assignment_id, declared_by)
   ON grants.conflict_declaration TO app_api;

-- A score for one criterion of the assignment's stage, once per criterion,
-- with the reviewer's comment, empty when there is none. Scores are added,
-- changed and removed only while the assignment is assigned.
CREATE TABLE grants.score (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  criterion_id uuid NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 10),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 2000)
    CONSTRAINT score_comment_text CHECK (comment !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]|^[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]|[\n \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  CONSTRAINT score_once UNIQUE (tenant_id, assignment_id, criterion_id),
  FOREIGN KEY (tenant_id, assignment_id, stage_id)
    REFERENCES grants.assignment (tenant_id, id, stage_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, stage_id, criterion_id)
    REFERENCES grants.rubric_criterion (tenant_id, stage_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX score_criterion ON grants.score (tenant_id, criterion_id);
SELECT app.enable_tenant_rls('grants.score');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON grants.score
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- A score changes only while its assignment is assigned. Like the checks in
-- migration 0011, it runs after the row-level security checks and foreign
-- keys, and its read runs under the caller's row-level security. The
-- assignment row is locked, so a submission waits for the change, or the
-- change sees the submission.
CREATE FUNCTION grants.check_score_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  changed grants.score;
BEGIN
  IF TG_OP = 'DELETE' THEN
    changed := OLD;
  ELSE
    changed := NEW;
  END IF;
  PERFORM FROM grants.assignment a
    WHERE a.tenant_id = changed.tenant_id AND a.id = changed.assignment_id
      AND a.status = 'assigned'
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scores change only while their assignment is open.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER check_score_change AFTER INSERT OR UPDATE OR DELETE ON grants.score
  FOR EACH ROW EXECUTE FUNCTION grants.check_score_change();

GRANT SELECT, DELETE,
      INSERT (tenant_id, assignment_id, stage_id, criterion_id, score, comment, created_by,
              updated_by),
      UPDATE (score, comment, updated_by)
   ON grants.score TO app_api;
