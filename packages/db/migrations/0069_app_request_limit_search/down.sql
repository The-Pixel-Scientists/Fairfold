-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0069, down: app.request_limit as migration 0041 left it. Row-level
-- security hides the counters from migrator, so the search counters cannot be
-- picked out: every counter is removed (TRUNCATE is not bound by row-level
-- security), which at most lets each client start a fresh window.

TRUNCATE app.request_limit;
ALTER TABLE app.request_limit
  DROP CONSTRAINT request_limit_bucket_check,
  ADD CONSTRAINT request_limit_bucket_check CHECK (bucket IN (
    'public', 'probe', 'general',
    'upload_files_membership', 'upload_bytes_membership',
    'upload_files_address', 'upload_bytes_address'));
