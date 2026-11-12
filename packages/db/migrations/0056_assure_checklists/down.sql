-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0056, down: remove checklists, their versions and
-- answers, in reverse order.
-- Rows cannot come back, so outside development the rollback for this
-- migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these tables, this fails and
-- changes nothing.

DROP TABLE assure.checklist_response_file;
DROP FUNCTION assure.link_file();
DROP TABLE assure.checklist_response;
DROP FUNCTION assure.keep_erased_answers();
DROP TABLE assure.checklist_version;
DROP TABLE assure.checklist;
DROP FUNCTION assure.check_checklist_version();
