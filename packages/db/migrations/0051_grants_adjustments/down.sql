-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0051, down: remove equality monitoring responses, the submission
-- route and reasonable adjustments, newest first. The application's unique
-- key goes last, once the adjustment's foreign key to it has gone. Rows
-- cannot come back, so outside development the rollback is a restore from
-- backup. Nothing cascades: this fails if a later migration refers to these.

DROP TABLE grants.monitoring_response;
DROP FUNCTION grants.check_monitoring_response();

DROP TRIGGER check_assisted_submission ON grants.application;
DROP FUNCTION grants.check_assisted_submission();
DROP TRIGGER keep_application_route ON grants.application;
DROP FUNCTION grants.keep_application_route();
ALTER TABLE grants.application
  DROP CONSTRAINT application_submitted_by_member,
  DROP CONSTRAINT application_submitted_by,
  DROP COLUMN submitted_by,
  DROP COLUMN submission_route;

DROP TABLE grants.adjustment;
DROP FUNCTION grants.keep_adjustment();
DROP FUNCTION grants.check_new_adjustment();

ALTER TABLE grants.application DROP CONSTRAINT application_round_organisation_key;
