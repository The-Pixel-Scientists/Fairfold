-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0106, down: remove app.erase_subject_documents() and every
-- right its owner was given. Files it erased stay erased. The owner role
-- stays: the roles script, not a migration, creates and removes roles.

DROP FUNCTION app.erase_subject_documents(uuid);
REVOKE SELECT (tenant_id, id, erased_at), UPDATE (erased_at) ON app.file
  FROM owner_app_erase_documents;
REVOKE SELECT (tenant_id, signature_request_id, file_id) ON app.signature_request_file
  FROM owner_app_erase_documents;
REVOKE SELECT (tenant_id, signature_request_id, person_id) ON app.signature_signer
  FROM owner_app_erase_documents;
REVOKE SELECT (tenant_id, id, status) ON party.party FROM owner_app_erase_documents;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_app_erase_documents;
REVOKE USAGE ON SCHEMA app, party FROM owner_app_erase_documents;
