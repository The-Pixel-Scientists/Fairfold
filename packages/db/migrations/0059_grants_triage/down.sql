-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0059, down: remove saved views, applied labels, the label set and
-- application owners, with their triggers and functions, in reverse order.
-- Rows cannot come back, so outside development the rollback for this
-- migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these tables, this fails and changes
-- nothing.

DROP TABLE grants.saved_view;
DROP TABLE grants.application_label;
DROP FUNCTION grants.refuse_archived_label();
DROP FUNCTION grants.set_added_at();
DROP TABLE grants.label;
DROP TABLE grants.application_owner;
DROP FUNCTION grants.set_assigned_at();
