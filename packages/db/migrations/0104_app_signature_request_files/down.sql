-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0104, down: remove signature request files and app_worker's
-- file link rights. A file linked to a request stays linked, so the sweep
-- never removes it; rows cannot come back, so outside development the
-- rollback for this migration is a restore from backup. Nothing cascades:
-- while a later migration's objects still refer to the table, this fails and
-- changes nothing.

REVOKE UPDATE (linked_at) ON app.file FROM app_worker;
REVOKE EXECUTE ON FUNCTION app.link_file(uuid) FROM app_worker;

DROP TABLE app.signature_request_file;
DROP TRIGGER check_signature_request_files ON app.signature_request;
DROP FUNCTION app.check_signature_request_files();
DROP FUNCTION app.link_signature_request_file();
