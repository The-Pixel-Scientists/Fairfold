# ADR 0021: Brand-neutral identifiers

- **Status:** accepted
- **Date:** 2026-10-04
- **Deciders:** Aaron Gardner

## Context

The suite's parent name is waiting for trade mark clearance. Fairfold is the
name we use until then, with each tool called "Fairfold <descriptor>", such
as Fairfold Grants ([ADR 0016](0016-modular-suite-and-shared-warehouse.md)).
A failed clearance must not cost a second round of risky changes.

Until now, code identifiers carried the product's working name: the package
scope, the environment variable prefix, database and bucket names, the
PostgreSQL custom settings that carry role verifiers, Compose project and
image names, Semgrep rule ids, the API's service and application names, and
the SBOM names. Renaming those touches security-critical files: the roles
script, the Postgres init script, the credential profiles in `dev-env`, the
database-name guard and CI. It also touches every developer's environment.
S02-02 is about to create the module packages, which would be born with the
brand.

## Options considered

1. **Keep the brand in identifiers**, and rename them at each rebrand.
   - Pros: nothing to do now.
   - Cons: every rebrand repeats a security-critical review and a reset of
     every developer's environment, and module packages multiply the work.
2. **A neutral prefix tied to the company, `tps`** (The Pixel Scientists).
   - Pros: survives any product or suite rename; short; distinct from the
     database role names (`app_api`, `migrator`).
   - Cons: three letters are generic, so an unrelated `TPS_` variable in a
     developer's shell is treated as ours and withheld from our commands.
     The npm scope `@tps` and the unscoped `tps` package belong to others
     (checked on 3 October 2026), so npm names need another form.
3. **A generic prefix**, such as `app`.
   - Pros: ties to nothing.
   - Cons: clashes with the `app_*` database roles and with other tools'
     variables, and says nothing about whose code it is.

## Decision

Option 2, with npm names in the company's own scope.

- **Identifiers** use `tps`: `TPS_` environment variables, `tps_<worktree>`
  databases, `tps-<worktree>` buckets, `tps.` PostgreSQL custom settings,
  `tps-` Semgrep rule ids, the `tps-api` service and application names, and
  Compose project and image names. No code identifier carries a product or
  suite brand.
- **npm names** use the `@pixel-scientists` scope, which was free on
  3 October 2026: `@pixel-scientists/*` packages, and
  `@pixel-scientists/workspace` for the root package. The SBOM is named
  `pixel-scientists-workspace`. Modules keep their working names under the
  scope, such as `@pixel-scientists/grants`. A name in a scope someone else
  owns lets them publish a package that a mistyped `pnpm add` without
  `--workspace` would install and run, so no npm name may sit in a scope or
  bare name we do not own.
- **User-facing names** come from one file,
  `packages/domain/src/platform/brand.ts`: `suiteName` ("Fairfold") and
  `productName` ("Fairfold Grants"). The console and portal headers and page
  titles, the OpenAPI title and their tests read it. The OpenAPI title is
  "Fairfold API", because one API serves every module. The two `index.html`
  files keep the name as text, because they load before any script.
- **Docs** say "Fairfold Grants" for the product and "Fairfold" for the
  suite.
- **Accepted ADRs** take the new names as an editorial change; their
  decisions do not change (D19, decided 3 October 2026).
- **The repository name**, local folders and worktree paths are Aaron's to
  change, when he chooses.
- **Publishing:** claim the `pixel-scientists` npm organisation now, before
  the scope is in use, even though nothing is published yet.

## Consequences

- A failed clearance changes `brand.ts`, the two `index.html` titles, the
  committed OpenAPI document and the docs.
- The change is made once, by a script, so the diff is mechanical and each
  security-critical file is small enough to read line by line.
- Each developer starts a fresh Compose project once, because its project,
  image and volume names change: stop the old project, then `pnpm dev` and
  `pnpm db:migrate`. Roles on the old server carry the old version comment,
  which the roles check no longer accepts. Databases under the old prefix
  go with the old volume; the drop guard no longer matches them.
- `pnpm stack` keeps its generated secrets under `~/.tps/stack/`, so each
  stack project is created afresh.
- Each `.env` file needs the new variable prefix.
- The browser key for scroll positions changes, so scroll restoration
  starts afresh once.
- Work in flight is converted with the same script when each branch
  refreshes from `main`.

## Dependency check

No dependency is added.
