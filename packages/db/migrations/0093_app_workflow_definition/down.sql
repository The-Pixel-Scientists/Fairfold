-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0093, down: remove the stored definitions, their checks and the
-- session actor, in reverse order. Rows cannot come back, so outside
-- development the rollback is a restore from backup. Nothing cascades: while
-- 0094's requests still refer to these tables, this fails and changes
-- nothing.

DROP TABLE app.workflow_definition_version;
DROP TABLE app.workflow_definition;
DROP FUNCTION app.check_workflow_definition_version();
DROP FUNCTION app.check_workflow_definition();
DROP FUNCTION app.session_actor();
