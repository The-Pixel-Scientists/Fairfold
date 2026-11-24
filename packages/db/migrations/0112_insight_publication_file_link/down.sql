-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0112, down: a publication run no longer links its output.
-- Files it linked stay linked, as app.file records a link once.

DROP TRIGGER link_output_file ON insight.publication_run;
DROP FUNCTION insight.link_output_file();
