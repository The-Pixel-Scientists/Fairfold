-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0100, down: remove document template versions. Rows cannot come
-- back, so outside development the rollback for this migration is a restore
-- from backup. Nothing cascades: while a later migration's objects still
-- refer to the table, this fails and changes nothing.

DROP TABLE app.document_template_version;
