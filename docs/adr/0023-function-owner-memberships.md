# ADR 0023: How migrations hand definer functions to their owners

- **Status:** accepted
- **Date:** 2026-10-04
- **Deciders:** Aaron Gardner

## Context

[ADR 0003](0003-query-builder-and-migrations.md) gives each approved definer
function its own `NOLOGIN` owner role, which owns that function and nothing
else, and says every role "belongs to no other role". Migrations run as
`migrator`, create the function and must then make its owner role own it.

PostgreSQL 16 allows `ALTER FUNCTION ... OWNER TO <owner>` only when the
role running it can `SET ROLE` to the new owner, and only when the new owner
holds `CREATE` on the function's schema. With no membership at all,
`migrator` cannot hand any function over, and a later
`CREATE OR REPLACE FUNCTION` must run as the owner too. S02-06
(`auth.session_context()`) and S03-05 (the tenant functions in
[ADR 0019](0019-tenant-addresses-public-pages-and-theming.md)) need this.

## Options considered

1. **`migrator` is a member of each owner role with `SET` but not
   `INHERIT`.** `migrator` can act as the owner only by an explicit
   `SET ROLE`, never holds the owner's grants otherwise, and cannot grant the
   membership on (`ADMIN FALSE`). Migrations give the owner `CREATE` on the
   schema only inside the transaction that hands the function over.
2. **A superuser step after every migration run assigns owners from a fixed
   map.** No membership, but a second superuser step in every install and
   upgrade, a function owned by `migrator` until that step runs, and no way
   for a `down.sql` to restore an owned function.
3. **An inheriting membership, or `CREATE` on the schema kept by each
   owner.** Simplest to write, but `migrator` would hold every owner's grants
   without saying so, or an owner could create objects that the catalogue
   test then has to find.

## Decision

Option 1. This amends ADR 0003's roles section: the one membership any of
its roles holds is `migrator`'s in each function owner role, granted
`WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`. The roles script grants it
again on every run, after resetting every membership, and the start-up
check reports any other membership, or that one with other options, as a
problem.

A migration hands a new definer function to its owner like this, all inside
the migration's transaction. It sets the function's `EXECUTE` grants first,
since once the owner holds the function `migrator` can no longer grant on
it; the grants move to the new owner with the function.

```sql
CREATE FUNCTION app.public_tenant(slug text) ...;
REVOKE ALL ON FUNCTION app.public_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_tenant(text) TO app_api, app_auth;
GRANT CREATE ON SCHEMA app TO owner_app_public_tenant;
ALTER FUNCTION app.public_tenant(text) OWNER TO owner_app_public_tenant;
REVOKE CREATE ON SCHEMA app FROM owner_app_public_tenant;
```

A later migration, or a `down.sql` restoring an earlier version, replaces
the function as its owner:

```sql
GRANT CREATE ON SCHEMA app TO owner_app_public_tenant;
SET LOCAL ROLE owner_app_public_tenant;
CREATE OR REPLACE FUNCTION app.public_tenant(slug text) ...;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM owner_app_public_tenant;
```

A `down.sql` that only drops the function needs neither: `migrator` owns
the schema, so it may drop anything in it.

## Consequences

- Migrations that add or change a definer function follow the two patterns
  above; review checks that `CREATE` is revoked in the same migration.
- `migrator` can act as any function owner. That adds little: it already
  owns every table the owners read and every grant they hold comes from it.
- The roles script stays at version 2, which first creates the owner roles.
  A new owner role still comes with a new version.
- `packages/db/scripts/roles.db.test.ts` hands a function over and replaces
  it as `migrator`, so a change that breaks the pattern fails `pnpm test:db`.
