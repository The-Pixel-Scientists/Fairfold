# ADR 0001: Monorepo and toolchain

- **Status:** accepted
- **Date:** 2026-09-27
- **Deciders:** Aaron Gardner

## Context

PixelGrant is one TypeScript monorepo with three apps (`api`, `console`,
`portal`) and four packages (`domain`, `db`, `ui`, `config`), as set out in
the [technical baseline](../V1-PLAN.md#technical-baseline). The toolchain must
behave the same on a Windows laptop, on Linux CI runners and in the containers
Compose runs. It must pin exact versions, so a build today and a build at
Gate 1 resolve the same code and the SBOM means something. And it must stay
small enough for a team of about four to understand end to end.

Node.js 24 is the current LTS line. It moves to maintenance on 20 October 2026
and is supported until 30 April 2028. Node.js 26 becomes LTS on 28 October
2026, with support to 30 April 2029. Node.js 25 and later no longer ship
Corepack.

A new release is the riskiest moment for a dependency. The npm compromises of
September 2025 (chalk and debug, then the Shai-Hulud worm) were found and
pulled within hours to days, so waiting a week avoids most of that risk.

## Options considered

Runtime:

1. **Node.js 24 LTS.** Pros: LTS today, ships Corepack, and every tool below
   supports it. Cons: in maintenance from 20 October 2026, so a move to 26
   falls inside V1.
2. **Node.js 26.** Pros: the longer support window. Cons: not LTS until a
   month after kickoff, and no Corepack.

Workspace and task running:

3. **pnpm workspaces on their own.** pnpm 12 has a task graph built in
   (`tasks.dependsOn` in `pnpm-workspace.yaml`).
   - Pros: one tool. The strict `node_modules` layout fails on undeclared
     dependencies. Since pnpm 11 the defaults help the supply chain: a release
     is not resolved until it is a day old, dependency build scripts are
     blocked unless listed in `allowBuilds`, and git or tarball sources deep in
     the tree are refused. `pnpm licenses` and `pnpm sbom` are built in.
     pnpm 12 fails on a misspelt setting rather than ignoring it.
   - Cons: pnpm 12.0.0 is a month old (26 August 2026) and moves quickly. No
     remote cache.
4. **pnpm plus Turborepo or Nx.**
   - Pros: local and remote caching, runs limited to affected packages.
   - Cons: another tool and upgrade stream; remote caching is a hosted service
     or another thing to run. With seven workspaces the saving is seconds.
5. **npm workspaces.**
   - Pros: ships with Node.js.
   - Cons: the hoisted layout hides undeclared dependencies. Its release-age
     gate is off by default and it has no per-package build-script allowlist.

Lint and format:

6. **ESLint with typescript-eslint, plus Prettier.**
   - Pros: type-aware rules such as `no-floating-promises` catch real bugs in
     async server code. React and accessibility plugins exist.
   - Cons: two tools, slower than native linters. typescript-eslint supports
     TypeScript up to 6.0, not 7.
7. **Biome.**
   - Pros: one fast tool for lint and format.
   - Cons: fewer type-aware rules, built on its own type inference rather
     than the TypeScript compiler. Its accessibility rules are a separate set
     we would have to map to our standards.

## Decision

Aaron has chosen Node.js 24 LTS with pnpm through Corepack (options 1 and 3),
with option 6 for lint and format. We move to Node.js 26 in a later sprint,
once it has settled as LTS; that move gets its own short ADR.

Versions, each released on or before 20 September 2026:

- Node.js 24.21.0, pinned in `devEngines.runtime`, `.node-version` and the
  base image tag, following 24.x releases.
- pnpm 12.5.1 in `packageManager` with its integrity hash, run through the
  Corepack bundled with Node.js 24 (`corepack enable`).
- TypeScript 6.0.3, not 7.0.2, until typescript-eslint supports 7.
- Vitest 5.0.1, one root config with `test.projects`: `node` projects for the
  packages and API, a jsdom project for UI components, and a `db` project
  that needs Postgres. Playwright 1.63.0, with its matching image in CI and
  Compose.
- ESLint 10.11.0 (flat config) with `@eslint/js` 10.0.1, typescript-eslint
  8.70.0 and eslint-plugin-react-hooks 7.1.1. Prettier 3.9.8.

Release age:

- `minimumReleaseAge: 10080` (7 days) in `pnpm-workspace.yaml`. It is never
  lowered. A security fix that cannot wait goes in `minimumReleaseAgeExclude`
  as one exact version, with the advisory id, the approver and the date in the
  pull request, and the entry is removed once that version is 7 days old.
- Container images follow the same rule: pinned by digest, and a digest is
  adopted only when it was published at least 7 days earlier, with the same
  recorded exception for security fixes.
- Rows marked "not chosen" in these ADRs' dependency tables show the latest
  release as evidence of upkeep. They are not pins.

Rules that keep it the same everywhere:

- `savePrefix: ''`, so every dependency is exact. The lockfile is committed;
  CI and image builds use `pnpm install --frozen-lockfile`. pnpm's other
  supply-chain defaults stay on, and `allowBuilds` starts empty: the only
  install scripts in the resolved tree are esbuild's and fsevents', and
  neither needs its script to work.
- Package scripts call Node scripts, not shell, with `shellEmulator: true` for
  the rest. `.gitattributes` already keeps LF endings for shell, SQL and
  Dockerfiles.
- ES modules, and TypeScript `strict` plus `noUncheckedIndexedAccess`.
- `pnpm check` runs `tsc -b`, ESLint, Prettier and the unit projects.
  `pnpm test:db` runs the `db` project against the worktree's database
  ([ADR 0005](0005-dev-topology.md)). `pnpm test:e2e` and `pnpm test:a11y`
  run Playwright.
- CI runs everything on Linux for each pull request, and `pnpm check` on
  Windows every night.

## Consequences

- Development machines need Node.js 24.21.0 with `corepack enable`. The
  pinned pnpm 12.5.1 runs whichever pnpm starts: Corepack fetches it, and a
  globally installed pnpm switches to it. CI sets `pmOnFail: error`.
- The move to Node.js 26 means installing Corepack separately
  (`npm install -g corepack`, 0.36.0 today) or letting pnpm manage its own
  version. We plan it for a sprint after 28 October 2026.
- A new version is 7 days old before we can use it. Fixes for bugs we hit in
  a dependency wait too, unless they are security fixes.
- TypeScript 7 waits for typescript-eslint, which accepts `>=4.8.4 <6.1.0`
  today. We check each month.
- eslint-plugin-jsx-a11y has not released since October 2024 and does not
  declare ESLint 10 support. We use the eslint-plugin-jsx-a11y-x fork, which
  does. Its provenance:
  - published from `es-tooling/eslint-plugin-jsx-a11y-x` on GitHub with an
    npm provenance attestation, by one npm maintainer (`43081j`);
  - its one new dependency, jsx-ast-utils-x 0.1.0, also carries provenance;
  - neither package has install scripts;
  - a first pass over the published 0.2.0 files found no network, child
    process, `eval` or environment access. A full read against the tagged
    source is part of the sprint 1 toolchain work, before it is added.

  It runs only in development and CI, and axe checks in real browsers stay the
  accessibility gate ([ADR 0006](0006-design-system.md)).
- Dependency updates arrive as one batched pull request a month, plus
  security fixes within the targets in [SECURITY.md](../../SECURITY.md).

## Dependency check

| Package | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| Node.js | 24.21.0 | MIT | 2026-09-07 | LTS; maintenance from 2026-10-20 |
| pnpm | 12.5.1 | MIT | 2026-09-18 | Active daily; 12.6.0 is too new |
| corepack | 0.36.0 | MIT | 2026-08-28 | Bundled with Node.js 24; separate from 25+ |
| typescript | 6.0.3 | Apache-2.0 | 2026-04-16 | 7.0.2 (2026-07-08) is latest |
| vitest | 5.0.1 | MIT | 2026-09-15 | Needs Node.js 22.12+, 24 or 26+ |
| @playwright/test | 1.63.0 | Apache-2.0 | 2026-09-04 | Active |
| eslint, @eslint/js | 10.11.0, 10.0.1 | MIT | 2026-09-18, 2026-02-06 | Active; 9.x in maintenance |
| typescript-eslint | 8.70.0 | MIT | 2026-09-07 | TypeScript below 6.1 only |
| eslint-plugin-react-hooks | 7.1.1 | MIT | 2026-04-17 | Supports ESLint 10 |
| eslint-plugin-jsx-a11y | 6.10.2 | MIT | 2024-10-26 | Stalled; no ESLint 10 support |
| eslint-plugin-jsx-a11y-x | 0.2.0 | MIT | 2026-05-10 | Fork with ESLint 10 support; provenance attested; no install scripts |
| prettier | 3.9.8 | MIT | 2026-09-17 | Active |
| jsdom | 30.1.0 | MIT | 2026-09-17 | Needs Node.js 24.15+ on the 24 line |
| turbo, nx (not chosen) | 2.11.4, 23.2.1 | MIT | 2026-09-24, 2026-09-09 | Both active |
| @biomejs/biome (not chosen) | 2.5.14 | MIT OR Apache-2.0 | 2026-09-16 | Active |
