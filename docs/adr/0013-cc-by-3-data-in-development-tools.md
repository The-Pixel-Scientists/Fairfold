# ADR 0013: CC BY 3.0 data files in development tools

- **Status:** accepted
- **Date:** 2026-09-28
- **Deciders:** Aaron Gardner

## Context

[ADR 0002](0002-licence-and-dependency-policy.md) sets the licences our
dependencies may use and names spdx-expression-parse for the licence check.
That package depends on spdx-exceptions 2.5.0, the SPDX list of licence
exception identifiers, which is published under CC-BY-3.0. ADR 0002's table
does not mention CC-BY-3.0, so the licence check fails on the tool that runs
it.

spdx-exceptions is a JSON list of identifiers with no code. It is installed
only as a development dependency, runs only in development and CI, and is
never bundled or shipped. CC BY 3.0 asks for attribution, which the package
and our SBOM carry.

## Options considered

1. **Allow CC-BY-3.0 per package, for data files in development
   dependencies only.**
   - Pros: keeps the parser ADR 0002 chose; each use is still a recorded
     exception with a reason and approver, and the check fails if such a
     package reaches the production tree.
   - Cons: one more entry in the policy.
2. **Replace spdx-expression-parse with our own SPDX parser.**
   - Pros: no exception.
   - Cons: more code to own for a solved problem, and a parser that sees less
     use than the one most of the npm ecosystem relies on.
3. **Vendor the exception list.**
   - Cons: the same licence, now copied into our repository and out of date.

## Decision

Option 1, as Aaron approved on 28 September 2026. ADR 0002's "Allowed per
package, with a recorded reason" row gains CC-BY-3.0, limited to data files
in development-only dependencies. `licence-policy.json` lists it, and its
first exception is spdx-exceptions 2.5.0. The same day Aaron approved
caniuse-lite 1.0.30001810 under CC-BY-4.0, which ADR 0002 already allows per
package for data files.

## Consequences

- `pnpm check:licences` passes with two recorded, development-only
  exceptions, and fails if either package becomes a production dependency.
- A new version of either package needs its exception updated, which makes
  the change visible in review.
- The quarterly review of exceptions covers these two.
