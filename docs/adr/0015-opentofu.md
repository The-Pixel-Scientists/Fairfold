# ADR 0015: OpenTofu for infrastructure as code

- **Status:** proposed
- **Date:** 2026-11-08
- **Deciders:** Aaron Gardner

## Context

The managed environment has to be created from code with no manual steps.
[Architecture rule 1](../ARCHITECTURE.md) keeps cloud specifics in
`infra/terraform/`, and [ADR 0012](0012-hosting-targets-and-cells.md) lays that
folder out for several targets.

[ADR 0002](0002-licence-and-dependency-policy.md) denies BUSL-1.1, and
Terraform has used that licence since version 1.6. Infrastructure tools run
with wide credentials over the whole environment, so they need the same
supply-chain care as anything else CI runs.

## Options considered

1. **Terraform 1.6 or later.** BUSL-1.1, which ADR 0002 denies.
2. **Terraform 1.5, the last MPL-2.0 release.** Allowed, but it no longer
   receives updates.
3. **OpenTofu.** MPL-2.0 and maintained, and it reads the same configuration
   language.
4. **Pulumi, or the cloud's own tools.** A rewrite in a different model, or a
   tie to one provider, which ADR 0012 rules out.

How the configuration is checked beyond `tofu fmt`:

5. **tflint and its Google ruleset, at current releases.** tflint's README at
   v0.55.0 and v0.65.0 says some files in its `terraform` package are BUSL-1.1
   and that release binaries are bound by both licences, so ADR 0002 denies it.
   The README at v0.50.0 has no such text. GitHub's licence field still reports
   MPL-2.0, which hides this. The ruleset is MPL-2.0 but runs only as a tflint
   plugin.
6. **The last tflint release under MPL-2.0 alone,** somewhere between those two
   versions. Allowed, but a linter frozen there stops receiving fixes and stops
   following the provider, and every update would need the same licence check.
7. **`tofu validate` and `trivy config`.** Both are already allowed: validation
   comes with OpenTofu, and CI already pins and verifies Trivy under ADR 0002.

## Decision

Option 3, as Aaron decided on 2 October 2026.

Option 7 is proposed here for Aaron's decision. tflint was the plan until its
licence was found to fail ADR 0002, and it gets no exception.

### Tool and folder

- OpenTofu runs all infrastructure code, as `tofu`.
- The folder stays `infra/terraform/`. It holds configuration in the Terraform
  language, and `docs/ARCHITECTURE.md` rule 1 names it.

### How tools are pinned

Every infrastructure tool and provider follows this policy, which applies
ADR 0002's pipeline hardening:

- It is pinned to an exact version. A container image is pinned by digest. A
  downloaded release is pinned by a SHA-256 committed to the repository, and
  by its signature against a pinned signer where the project signs its
  releases.
- The version is at least 7 days old when it is pinned or updated.
- It has an ADR 0002 record: licence, exact version and release date,
  maintenance, 12 months of advisories, and provenance.
- Each root commits `.terraform.lock.hcl`, with provider hashes for
  `linux_amd64`, `darwin_arm64` and `windows_amd64`.

### How `tofu` runs

- It is not installed locally. It runs from OpenTofu's container image, pinned
  by digest, if the project's guidance at that version supports running the
  image directly. Otherwise it is downloaded like CI's other tools, with the
  checksum and signature checks above.
- In CI, it is downloaded and checked in that way. CI runs `tofu fmt -check`,
  `tofu validate` and `trivy config` with no backend, and has no credentials
  for Google.
- **Nothing applies from CI, and no CI job plans against Google.** Aaron applies
  by hand with his own credentials, until Workload Identity Federation is in
  place.
- Remote state lives in a Cloud Storage bucket in `europe-west2`, and bucket
  names and project ids reach each root through `-backend-config`. No state,
  plan or `.tfvars` file is committed.

### What waits for staging

Exact versions, digests and checksums are recorded with the commit that first
uses each tool, along with the checks of its licence and release date. Nothing
has been installed, pinned or run yet, and the first real `apply` needs a
staging project.

## Consequences

- The licence stays compatible with ADR 0002, and the configuration language
  stays familiar.
- Documentation and examples written for Terraform mostly apply, but a feature
  added to Terraform after the fork may not exist in OpenTofu.
- Without tflint, nothing checks provider-specific values, such as a machine
  type that does not exist, or unused declarations, before an `apply`.
  `tofu validate` covers syntax, types and references, and `trivy config`
  covers security settings. Other mistakes surface in review or at `apply`.
- Updating a tool means updating its committed checksum or digest in the same
  pull request, so tool changes show up in review.
- Until Workload Identity Federation arrives, applying depends on one person's
  credentials, and only that person can change the environment.

## Dependency check

Each licence is checked again against the exact version when it is first used,
including any code the tool bundles. The check reads the tool's README and
licence files at that version, because a repository's reported licence can miss
a second licence on its release binaries. A version that carries BUSL-1.1 code
cannot be used under ADR 0002.

| Tool                                                    | Licence                                | ADR 0002 class                          | Version, release date, digest or checksum                                   |
| ------------------------------------------------------- | -------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| OpenTofu                                                | MPL-2.0                                | Allowed                                 | Recorded with first use                                                     |
| `hashicorp/google` provider, from the OpenTofu registry | MPL-2.0                                | Allowed                                 | Recorded with first use                                                     |
| Trivy (`trivy config`)                                  | Apache-2.0                             | Allowed                                 | 0.74.0 and its record in ADR 0002; bundled code checked with first use here |
| tflint (not chosen)                                     | MPL-2.0 + BUSL-1.1 in release binaries | Denied                                  | Not applicable                                                              |
| tflint Google ruleset (not chosen)                      | MPL-2.0                                | Allowed, but runs only as tflint plugin | Not applicable                                                              |
| Terraform 1.6 or later (not chosen)                     | BUSL-1.1                               | Denied                                  | Not applicable                                                              |
