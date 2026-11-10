-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0048, down: drop restore mode and the ledger's second writer.
-- Dropping the table removes every right and policy on it.

DROP FUNCTION app.restore_erasure_ledger_row(uuid, uuid, text, uuid, uuid, timestamptz);
DROP TABLE app.restore_mode;
