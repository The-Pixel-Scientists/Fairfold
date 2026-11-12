-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0059, up: application owners, the tenant's label set and labels
-- on applications, and saved views of the submissions list (S12-20, E7).
--
-- All four are tenant tables under forced row-level security, with one tenant
-- term on every policy and composite foreign keys, ON DELETE RESTRICT, to the
-- application, label and membership they name. They hold ids, colour tokens,
-- flags, times and short tenant configuration names, never a person's name
-- or email. Limits copy modules/grants/src/contracts/triage and views. Every
-- time column is set by the database, whatever the caller sends, and none is
-- in a grant. Join tables carry an id too, since the schema lint and the
-- cross-tenant test need UNIQUE (tenant_id, id) on every tenant table.
--
-- The server (S12-39) checks at write time that an owner holds
-- grants.applications.read, that only a view's creator updates it, and that
-- only its creator or a programme manager deletes it. It writes the audit
-- events and the label set's config_version rows.

CREATE FUNCTION grants.set_assigned_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.assigned_at := pg_catalog.now();
  RETURN NEW;
END
$function$;

-- At most one owner per application; clearing the owner deletes the row.
CREATE TABLE grants.application_owner (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, application_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES grants.application (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, assigned_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX application_owner_membership ON grants.application_owner (tenant_id, membership_id);
SELECT app.enable_tenant_rls('grants.application_owner');
CREATE TRIGGER set_assigned_at BEFORE INSERT OR UPDATE ON grants.application_owner
  FOR EACH ROW EXECUTE FUNCTION grants.set_assigned_at();

-- A label's name is tenant configuration and must not name a person. Its
-- checks copy app.tag's (0052): trimmed as a JavaScript trim, and not blank
-- once zero-width characters are left out. The colours are theme token names.
CREATE TABLE grants.label (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
    CONSTRAINT label_name_length CHECK (char_length(name) BETWEEN 1 AND 40)
    CONSTRAINT label_name_trimmed CHECK (name !~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$')
    CONSTRAINT label_name_not_blank CHECK (name ~ '[^\t\n\v\f\r \u00a0\u00ad\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]'),
  colour text CHECK (colour IN ('neutral', 'info', 'success', 'warning', 'danger')),
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX label_name_unique ON grants.label (tenant_id, lower(name));
SELECT app.enable_tenant_rls('grants.label');
-- Labels are archived, never deleted, so history keeps its meaning.
SELECT app.deny_command('grants.label', 'DELETE');
CREATE TRIGGER set_created_at BEFORE INSERT ON grants.label
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON grants.label
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE FUNCTION grants.set_added_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.added_at := pg_catalog.now();
  RETURN NEW;
END
$function$;

-- An archived label is not newly applied; labels already applied stay. The
-- label is read as the caller, under its row-level security, and locked so
-- an archive waits for, or is seen by, an apply in flight. A label the caller
-- cannot see is left to the foreign key.
CREATE FUNCTION grants.refuse_archived_label()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  is_archived boolean;
BEGIN
  SELECT l.archived INTO is_archived
    FROM grants.label l
   WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.label_id
     FOR SHARE;
  IF is_archived THEN
    RAISE EXCEPTION 'An archived label cannot be applied.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$function$;

-- A label is on an application once: the server inserts with ON CONFLICT DO
-- NOTHING, and removes it by deleting the row.
CREATE TABLE grants.application_label (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  label_id uuid NOT NULL,
  added_by uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, application_id, label_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES grants.application (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, label_id) REFERENCES grants.label (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, added_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX application_label_label ON grants.application_label (tenant_id, label_id);
SELECT app.enable_tenant_rls('grants.application_label');
SELECT app.deny_command('grants.application_label', 'UPDATE');
CREATE TRIGGER set_added_at BEFORE INSERT ON grants.application_label
  FOR EACH ROW EXECUTE FUNCTION grants.set_added_at();
CREATE TRIGGER refuse_archived_label BEFORE INSERT ON grants.application_label
  FOR EACH ROW EXECUTE FUNCTION grants.refuse_archived_label();

-- A saved view is shared by the whole tenant, and stores only the list's
-- filter, sort and column keys (a column id, or answer.<field id>): never a
-- resolved list of applications, a projection or answer values. One member
-- saves it and another, perhaps with less access, runs it, so the server
-- (S12-39, S12-49) re-checks every stored filter and column against the
-- viewer's permissions, scope, blind-review projection and classification on
-- every use, and validates them against the contract's schemas. The database
-- checks only shape and size, and nothing here resolves a stored filter.
CREATE TABLE grants.saved_view (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
    CONSTRAINT saved_view_name_length CHECK (char_length(name) BETWEEN 1 AND 80)
    CONSTRAINT saved_view_name_trimmed CHECK (name !~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$')
    CONSTRAINT saved_view_name_not_blank CHECK (name ~ '[^\t\n\v\f\r \u00a0\u00ad\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]'),
  filter jsonb NOT NULL
    CONSTRAINT saved_view_filter_shape CHECK (
      jsonb_typeof(filter) = 'object' AND octet_length(filter::text) <= 4096),
  sort jsonb NOT NULL
    CONSTRAINT saved_view_sort_shape CHECK (
      jsonb_typeof(sort) = 'object' AND octet_length(sort::text) <= 4096),
  columns text[] NOT NULL
    CONSTRAINT saved_view_columns_shape CHECK (
      array_ndims(columns) = 1 AND cardinality(columns) BETWEEN 1 AND 30
      AND array_position(columns, NULL) IS NULL AND octet_length(columns::text) <= 2048),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('grants.saved_view');
CREATE TRIGGER set_created_at BEFORE INSERT ON grants.saved_view
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON grants.saved_view
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

GRANT SELECT, INSERT (tenant_id, application_id, membership_id, assigned_by),
      UPDATE (membership_id, assigned_by), DELETE
   ON grants.application_owner TO app_api;
GRANT SELECT, INSERT (tenant_id, id, name, colour, created_by, updated_by),
      UPDATE (name, colour, archived, updated_by)
   ON grants.label TO app_api;
GRANT SELECT, INSERT (tenant_id, application_id, label_id, added_by), DELETE
   ON grants.application_label TO app_api;
GRANT SELECT, INSERT (tenant_id, id, name, filter, sort, columns, created_by, updated_by),
      UPDATE (name, filter, sort, columns, updated_by), DELETE
   ON grants.saved_view TO app_api;

-- The CSV export job (S12-49) reads a view and its rows' owners and labels.
GRANT SELECT ON grants.saved_view, grants.application_owner, grants.label,
   grants.application_label TO app_worker;
