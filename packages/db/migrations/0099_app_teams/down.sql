-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0099, down: remove break-glass grants, team members, teams and
-- the member setting's function, in reverse order. app.membership is
-- unchanged. Rows cannot come back, so outside development the rollback for
-- this migration is a restore from backup. Nothing cascades: while a later
-- migration's objects still refer to these, this fails and changes nothing.

DROP TABLE app.break_glass;
DROP FUNCTION app.set_break_glass_times();
DROP TABLE app.team_member;
DROP FUNCTION app.keep_team_member_removal();
DROP TABLE app.team;
DROP FUNCTION app.keep_team_archive();
DROP FUNCTION app.current_membership_id();
