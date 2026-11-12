-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0054, down: remove lookup snapshots and their officers, in reverse order.
-- Rows cannot come back, so outside development the rollback for this
-- migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these tables, this fails and
-- changes nothing.

DROP TABLE assure.lookup_officer;
DROP FUNCTION assure.link_officer_once();
DROP TABLE assure.lookup_snapshot;
