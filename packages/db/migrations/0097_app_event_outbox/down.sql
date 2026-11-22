-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0097, down: remove the outbox and the counters, each with its
-- triggers, functions, policies and grants. publish() writes the outbox, so
-- roll back the code that calls it first. Events and counters cannot come
-- back, so outside development the rollback for this migration is a
-- restore from backup. Nothing cascades.

DROP TABLE app.event_outbox;
DROP FUNCTION app.set_event_retention();
DROP FUNCTION app.number_event();

DROP TABLE app.event_sequence;
DROP FUNCTION app.keep_event_sequence();
