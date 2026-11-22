-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0103, down: remove signature signers. Rows cannot come back, so
-- outside development the rollback for this migration is a restore from
-- backup. Nothing cascades: while a later migration's objects still refer to
-- the table, this fails and changes nothing.

DROP TABLE app.signature_signer;
DROP FUNCTION app.check_signature_signer();
DROP FUNCTION app.keep_signature_signer();
