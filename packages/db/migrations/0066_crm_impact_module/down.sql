-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0066, down: restore both checks as migration 0063 wrote them, in
-- the reverse of the order up.sql widens them.
--
-- Row-level security hides every tenant's rows from migrator, so this cannot
-- look for offending rows first, but adding a check reads every row whatever
-- the policies. Each restore runs in a block that turns the check's
-- violation into a clear error, and the rollback then changes nothing. It
-- never deletes or rewrites data: restore the backup taken before the
-- rollback instead (ADR 0003).

DO $restore$
BEGIN
  ALTER TABLE crm.merge_record DROP CONSTRAINT merge_record_counts;
  ALTER TABLE crm.merge_record ADD CONSTRAINT merge_record_counts CHECK (
    jsonb_typeof(repointed_counts) = 'object'
    AND NOT jsonb_path_exists(repointed_counts, 'strict $.keyvalue() ? (!(@.key like_regex "^(platform|party|grants|crm|assure|forms|privacy|insight)$") || @.value.type() != "object")')
    AND NOT jsonb_path_exists(repointed_counts, 'strict $.* ? (@.type() == "object").keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$") || @.value.type() != "number" || @.value < 0 || @.value != @.value.floor())'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0066 cannot be rolled back: merge_record_counts fails because a merge record counts rows re-pointed in the impact module.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

DO $restore$
BEGIN
  ALTER TABLE crm.interaction DROP CONSTRAINT interaction_source_module_check;
  ALTER TABLE crm.interaction ADD CONSTRAINT interaction_source_module_check
    CHECK (source_module IN (
      'platform', 'party', 'grants', 'crm', 'assure', 'forms', 'privacy', 'insight'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0066 cannot be rolled back: interaction_source_module_check fails because a timeline entry names the impact module.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;
