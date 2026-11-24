-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0112, up: a publication run links its output (B15-03, ADR 0030,
-- "One file, one link"). When the preparation job sets a run's output, the
-- file is linked to the run in the same statement, through app.link_file(),
-- as every join table's trigger does, so no other record can take it and
-- platform code knows it is in use. Migration 0080's trigger has already
-- checked the file is clean, not erased and never linked. app_worker holds
-- EXECUTE on app.link_file(uuid) and UPDATE (linked_at) on app.file since
-- migration 0104, so this grants nothing.

CREATE FUNCTION insight.link_output_file()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM app.link_file(NEW.output_file_id);
  RETURN NULL;
END
$function$;
CREATE TRIGGER link_output_file AFTER UPDATE OF output_file_id ON insight.publication_run
  FOR EACH ROW WHEN (NEW.output_file_id IS DISTINCT FROM OLD.output_file_id)
  EXECUTE FUNCTION insight.link_output_file();
