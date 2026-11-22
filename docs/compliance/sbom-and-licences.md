# SBOM and licences

This page says what each release produces so you can check what is in the
software and where it came from, how to verify it, and which licences apply.

## Status

**Current release:** not yet available. No release has been tagged. The
release pipeline exists in `.github/workflows/release.yml`, but this edition
cannot quote a release tag, date or inventory. The second edition will.

Until then, build the inventory yourself from a source checkout:
`pnpm check:licences` checks every dependency against the policy in
`licence-policy.json` and fails on a conflict.

## What each release produces

Pushing a release tag (`vX.Y.Z`) builds the API, console and portal images
once, then:

1. scans each image;
2. signs each image by digest, keyless, with cosign;
3. attaches an SPDX SBOM and a CycloneDX SBOM, both made by Syft, as signed
   attestations on each image;
4. builds a licence inventory from the CycloneDX SBOMs and the licence check
   of the same commit. The release fails if a shipped package breaks the
   policy, has no licence, or holds an exception past its quarterly review.

The inventory is a JSON file and a readable Markdown file. It lists every
shipped package with its licence, and lists separate containers and CI tools
apart from the dependency table. Where the project publishes the inventory
for funders is not yet available.

## Verify a release

You need [cosign](https://docs.sigstore.dev/cosign/). Use the image digest,
not the tag. Replace the placeholders.

```sh
registry="<release registry>"
tag="v1.2.3"
digest="sha256:<image digest>"
ref="$registry/api@$digest"
identity="https://github.com/The-Pixel-Scientists/Fairfold/.github/workflows/release.yml@refs/tags/$tag"
issuer="https://token.actions.githubusercontent.com"

cosign verify "$ref" \
  --certificate-identity "$identity" --certificate-oidc-issuer "$issuer"
cosign verify-attestation "$ref" --type spdxjson \
  --certificate-identity "$identity" --certificate-oidc-issuer "$issuer"
cosign verify-attestation "$ref" --type cyclonedx \
  --certificate-identity "$identity" --certificate-oidc-issuer "$issuer"
```

Repeat for `console` and `portal`. These are the checks the promotion job
runs before it rolls out an image. Deploy an image only when all three pass.
The `verify-attestation` command prints the signed SBOM in its payload.

The command-line tool is released on its own with a tag `cli-vX.Y.Z`, as a
signed tarball with SBOMs. Its verification steps are in `tools/cli/README.md`.

## Licences

| Part | Licence |
| --- | --- |
| The software (apps, packages and modules) | AGPL-3.0-or-later, see [LICENSE](../../LICENSE) |
| Documentation, including this pack | CC BY 4.0, see [LICENSE-docs](../../LICENSE-docs) |
| Third-party notices | [NOTICE](../../NOTICE) |

AGPL-3.0-or-later means that if you run a modified version for others over a
network, you must offer them the modified source. Running the unmodified
release needs no extra step. Take your own legal advice.

### Dependency policy

The policy is in `licence-policy.json`, explained in
[ADR 0002](../adr/0002-licence-and-dependency-policy.md) and
[ADR 0013](../adr/0013-cc-by-3-data-in-development-tools.md).

- Allowed for any package: MIT, MIT-0, ISC, 0BSD, BSD-2-Clause,
  BSD-3-Clause, Apache-2.0, BlueOak-1.0.0, CC0-1.0 and MPL-2.0.
- Other licences need a named exception for one package version, with a
  reason, an approver and a date, reviewed every quarter.
- Denied: licences that restrict use or field of use, such as SSPL-1.0,
  BUSL-1.1 and the non-commercial Creative Commons licences.

### Services that run as separate containers

These are not linked into the software. They run beside it, and the policy
requires an OSI-approved licence for each.

| Service | Role | Licence |
| --- | --- | --- |
| PostgreSQL | Database | PostgreSQL licence |
| SeaweedFS | File storage | Apache-2.0 |
| ClamAV | Malware scanning | GPL-2.0-only |
| nginx | Reverse proxy | BSD-2-Clause |
| Mailpit | Test mailbox, development only | MIT |

CI tools that never ship: cosign (Apache-2.0), gitleaks (MIT), Semgrep
(LGPL-2.1-only), Syft (Apache-2.0) and Trivy (Apache-2.0).

## What you must do

- Verify signatures before you deploy.
- Keep the SBOM for each release you run. You need it to answer "are we
  affected?" when a vulnerability is announced.
- Keep your own inventory for anything you add.
