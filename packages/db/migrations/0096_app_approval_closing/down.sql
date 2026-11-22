-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0096, down: stop closing requests and remove the link check.
-- Closed requests stay as they are. While a module link table's trigger
-- still uses app.check_approval_link(), this fails and changes nothing.

DROP FUNCTION app.check_approval_link();
REVOKE UPDATE (status, closed_by, close_reason) ON app.approval_request FROM app_api;
DROP TRIGGER check_approval_closing ON app.approval_request;
DROP FUNCTION app.check_approval_closing();
