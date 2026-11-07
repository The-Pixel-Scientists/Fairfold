-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0017, down: remove the purge functions, app.request_limit and
-- app.idempotency_key, each with its triggers and trigger functions.
--
-- Dropping a table removes its rows, policies, triggers, indexes and grants.
-- Keys and counters are short-lived and hold no value worth restoring, so a
-- rollback loses nothing a client cannot send again: a retry made after it
-- is treated as a new request.

DROP FUNCTION app.delete_expired_request_limits(integer);
DROP FUNCTION app.delete_expired_idempotency_keys(integer);

DROP TRIGGER set_request_limit_expiry ON app.request_limit;
DROP TABLE app.request_limit;
DROP FUNCTION app.set_request_limit_expiry();

DROP TRIGGER keep_idempotency_key ON app.idempotency_key;
DROP TRIGGER set_idempotency_key_expiry ON app.idempotency_key;
DROP TABLE app.idempotency_key;
DROP FUNCTION app.keep_idempotency_key();
DROP FUNCTION app.set_idempotency_key_expiry();
