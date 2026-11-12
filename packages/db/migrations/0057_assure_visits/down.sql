-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0057, down: remove monitoring visits, their attendees
-- and evidence, in reverse order.
-- Rows cannot come back, so outside development the rollback for this
-- migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these tables, this fails and
-- changes nothing.

DROP TABLE assure.visit_evidence;
DROP FUNCTION assure.keep_erased_evidence();
DROP TABLE assure.visit_attendee;
DROP TABLE assure.monitoring_visit;
