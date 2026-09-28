# ADR 0002: Licence and dependency policy

- **Status:** proposed
- **Date:** 2026-09-27
- **Deciders:** Aaron Gardner

## Context

[LICENSE](../../LICENSE) holds the AGPL-3.0 text, [LICENSE-docs](../../LICENSE-docs)
holds CC BY 4.0 and [NOTICE](../../NOTICE) says the software is under
"version 3". That wording does not say whether later versions apply. The
strategy paper, *PixelGrant: The Gift and the Service*, sets AGPL-3.0 for the
platform, CC BY 4.0 for documentation, the data model and the evidence pack,
and a permissive licence for the plugin API so funders can write private
plugins.

Contributors sign off under the DCO; there is no CLA. Nobody can relicense a
contribution later without its author's agreement, so the choices that are
hard to change must be made before the first outside contribution. Every
dependency must be compatible with AGPL-3.0, and anything the plugin SDK
depends on must also suit a permissive licence.

## Options considered

Version clause:

1. **AGPL-3.0-only.** Pros: the terms are fixed and nobody can use our code
   under a version we have not read. Cons: moving to a later version needs
   every contributor's consent. We could not combine with code released under
   a later version only.
2. **AGPL-3.0-or-later.** Pros: the default the licence's own "How to Apply"
   section suggests. Section 14 commits the FSF to new versions "similar in
   spirit". It keeps us compatible with future GPL-family releases. It can be
   narrowed later (new code can be released as "only"), while "only" cannot be
   widened without everyone's consent. Cons: we trust the FSF with terms not
   yet written.
3. **AGPL-3.0-only with a proxy under section 14**, letting a named body accept
   later versions. Pros: the steward keeps control. Cons: the stewardship body
   does not exist yet. Naming a person or the service company concentrates the
   control the two-entity model is meant to spread.

Plugin API licence:

4. **MIT SDK only.** Cons: the FSF's view is that a plugin sharing the
   program's process and data structures forms one combined work, so a
   permissive SDK alone may not free in-process plugins from the AGPL.
5. **MIT SDK plus an additional permission under AGPL section 7**, covering
   works that use only the published plugin interfaces. Twenty's "Application
   Exception" is a current precedent. Cons: needs careful legal drafting.
6. **Out-of-process plugins only** (HTTP API and webhooks). Clean, but limits
   what a plugin can do.

## Decision

- Code: **AGPL-3.0-or-later** (option 2), as Aaron has chosen. It is the
  choice we can still undo: we can narrow to "only" later, but could never
  widen without every contributor. Every source file carries
  `SPDX-License-Identifier: AGPL-3.0-or-later` and every private workspace
  package sets the same `license` field.
- Documentation in `docs/`, including the written data model and the evidence
  pack: CC BY 4.0. The SQL that implements the schema is code.
- Plugin API: option 5 in Phase 2, drafted with a solicitor. The SDK package
  is MIT with its own `LICENSE` and depends only on permissive code.
- The console and portal link to the source of the running version, so any
  operator who modifies the code can meet section 13.

Dependency policy, applied to everything we link or bundle:

| Class | Licences |
| --- | --- |
| Allowed | MIT, MIT-0, ISC, 0BSD, BSD-2-Clause, BSD-3-Clause, Apache-2.0, BlueOak-1.0.0, CC0-1.0, MPL-2.0 (unless marked "Incompatible With Secondary Licenses") |
| Allowed per package, with a recorded reason | CC-BY-4.0 (data files only), Python-2.0, Unlicense, LGPL-2.1-or-later, LGPL-3.0, GPL-3.0 and AGPL-3.0, only or or-later (never in the plugin SDK) |
| Denied | SSPL-1.0, BUSL-1.1, anything with the Commons Clause, Elastic-2.0, Functional Source License, PolyForm, CC non-commercial or no-derivatives, the JSON licence, GPL-2.0-only, CDDL-1.0, EPL-1.0, no licence, `UNLICENSED`, unreviewed custom text |

Services that run as separate containers (Postgres, ClamAV under GPL-2.0,
object storage, the mail catcher) are not linked. They need an OSI-approved
licence, are listed in the SBOM, and are not held to the table above. CI
tools that never ship, such as Semgrep, are treated the same way.

Adding a dependency:

- Only the tech lead adds dependencies. The pull request records the
  licence, exact version and release date, maintenance (recent releases and
  commits), advisory history for the last 12 months, any install scripts in
  its resolved tree, and provenance: an npm provenance attestation or a signed
  release, or a note that there is none.

Licence checks in CI:

- A `pnpm check:licences` script runs `pnpm licenses list --json`, parses each
  SPDX expression with spdx-expression-parse, and checks it against
  `licence-policy.json` at the root. `OR` passes if any branch is allowed;
  `AND` needs every part allowed. Unknown, missing and denied licences fail.
  Per-package exceptions name the package, version, reason and approver.
- The same script checks that source files carry the SPDX line.
- Syft generates SPDX and CycloneDX SBOMs for each release image. Trivy scans
  the images for vulnerabilities and reports OS package licences without
  blocking on them.

Pipeline hardening:

- Actions are pinned by commit SHA and images by digest. Every tool binary CI
  downloads is pinned by version, and its expected SHA-256 is committed in the
  repository and checked before use. Trivy's own supply chain was compromised
  in March 2026, so a pinned tag alone is not enough.
- Where a project signs its releases, CI also verifies the signature against
  a pinned signer with cosign: Syft's signed checksums and Trivy's Sigstore
  bundles, each against its release workflow's identity and GitHub's OIDC
  issuer. gitleaks publishes checksums only, so the committed SHA-256 is its
  check.
- Workflows declare `permissions: contents: read` at the top and widen it
  per job only where a job needs it. No workflow runs pull request code under
  `pull_request_target`. Checkout sets `persist-credentials: false`. Scanner
  jobs get no secrets.
- Semgrep 1.177.0 runs static analysis, from its container image pinned by
  digest, and gitleaks 8.30.1 scans for secrets, on every pull request.
- Our own Semgrep rules, each with a passing and a failing example, block:
  - `sql.raw`, `sql.lit`, and `sql.id`, `sql.ref` or `sql.table` with a
    non-literal argument ([ADR 0003](0003-query-builder-and-migrations.md));
  - importing `pg`, `kysely` or `pg-boss` outside `packages/db`;
  - importing `better-auth`, or the sign-in tenant helper, outside
    `apps/api/src/auth` ([ADR 0010](0010-authentication-security-rules.md));
  - `dangerouslySetInnerHTML`;
  - importing Radix outside `packages/ui` ([ADR 0006](0006-design-system.md));
  - loose response schemas ([ADR 0004](0004-api-contract.md)).

Alternatives for the licence check: license-checker-rseidelsohn (a maintained
fork of license-checker, which has not released since 2019) walks
`node_modules` rather than the lockfile. Syft with Grant would cover container
packages too, but Grant is young. We can add either later.

## Consequences

- NOTICE needs "version 3 of the License, or (at your option) any later
  version", and CONTRIBUTING's licensing line needs the same, before the first
  outside contribution.
- The section 7 plugin permission only covers code whose authors granted it.
  Publishing the drafted text before outside contributions arrive avoids
  asking every contributor later.
- The Gate 1 SBOM and licence inventory come straight from the pipeline.
- Exceptions in `licence-policy.json` are reviewed each quarter.
- Updating a CI tool means updating its committed checksum in the same pull
  request, which makes tool changes visible in review.
- gitleaks is feature complete: its author now ships security fixes only and
  works on Betterleaks. We review the choice at the Gate 1 tooling check.

## Dependency check

| Tool | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| spdx-expression-parse | 5.0.0 | MIT | 2026-07-16 | Active |
| Syft | 1.52.0 | Apache-2.0 | 2026-09-17 | Active; cosign-signed checksums |
| Trivy | 0.74.0 | Apache-2.0 | 2026-08-14 | Active; Sigstore bundles; supply-chain advisory 2026-03-21 |
| cosign | 3.1.3 | Apache-2.0 | 2026-08-06 | Verifies the signatures above |
| Semgrep | 1.177.0 | LGPL-2.1 | 2026-09-10 | Active; CI only, not linked |
| gitleaks | 8.30.1 | MIT | 2026-03-21 | Security fixes only; checksums, no signature |
| Betterleaks (not chosen) | 1.8.1 | MIT | 2026-08-18 | gitleaks author's successor; created February 2026 |
| Grant (not chosen) | 0.6.8 | Apache-2.0 | 2026-07-08 | Pre-1.0, 189 stars |
| license-checker-rseidelsohn (not chosen) | 5.0.1 | BSD-3-Clause | 2026-05-27 | Active fork |
| license-checker (not chosen) | 25.0.1 | BSD-3-Clause | 2019-01-10 | Unmaintained |
