-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0069, up: app.request_limit gains the search bucket (B11-02),
-- so the console search is counted apart from the general limits. Each
-- search reads people and writes audit rows, so it has a lower limit of its
-- own; the key is still an HMAC under the server key, never a session or
-- user id in clear.

ALTER TABLE app.request_limit
  DROP CONSTRAINT request_limit_bucket_check,
  ADD CONSTRAINT request_limit_bucket_check CHECK (bucket IN (
    'public', 'probe', 'general', 'search',
    'upload_files_membership', 'upload_bytes_membership',
    'upload_files_address', 'upload_bytes_address'));
