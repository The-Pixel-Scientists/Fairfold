-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0066, up: let crm's timeline and merge records name the impact
-- module, registered with migration 0065.
--
-- Both checks keep their names and shapes and only widen, so every existing
-- row still passes. No row is read, written or rewritten, and no grant,
-- policy or column changes. The lists copy moduleIds in
-- packages/domain/src/platform; crm/contracts.test.ts reads them back so
-- neither can change alone.

ALTER TABLE crm.interaction DROP CONSTRAINT interaction_source_module_check;
ALTER TABLE crm.interaction ADD CONSTRAINT interaction_source_module_check
  CHECK (source_module IN (
    'platform', 'party', 'grants', 'crm', 'assure', 'forms', 'privacy', 'insight', 'impact'));

ALTER TABLE crm.merge_record DROP CONSTRAINT merge_record_counts;
ALTER TABLE crm.merge_record ADD CONSTRAINT merge_record_counts CHECK (
  jsonb_typeof(repointed_counts) = 'object'
  AND NOT jsonb_path_exists(repointed_counts, 'strict $.keyvalue() ? (!(@.key like_regex "^(platform|party|grants|crm|assure|forms|privacy|insight|impact)$") || @.value.type() != "object")')
  AND NOT jsonb_path_exists(repointed_counts, 'strict $.* ? (@.type() == "object").keyvalue() ? (!(@.key like_regex "^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$") || @.value.type() != "number" || @.value < 0 || @.value != @.value.floor())'));
