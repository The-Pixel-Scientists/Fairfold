-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0050, down: drop the search indexes and generated columns, in
-- reverse order. Every value dropped is derived from a column that stays.

DROP INDEX party.person_search_vector;
DROP INDEX party.organisation_search_vector;
ALTER TABLE party.person DROP COLUMN search_vector;
ALTER TABLE party.organisation DROP COLUMN search_vector;
DROP INDEX party.person_email_trgm;
DROP INDEX party.person_family_name_trgm;
DROP INDEX party.person_given_name_trgm;
DROP INDEX party.organisation_identifier_identifier_trgm;
DROP INDEX party.organisation_name_trgm;
