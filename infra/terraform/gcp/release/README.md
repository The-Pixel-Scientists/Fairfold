# Release root

The Google side of [the release workflow](../../../../.github/workflows/release.yml):
the registry its images go to, and the identity federation it signs in
through, so no key is stored in GitHub
([ADR 0015](../../../../docs/adr/0015-opentofu.md)). Apply it straight after
the state root, before the first tag.

| Resource                           | What it is                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `tps-<environment>-<cell>-release` | Artifact Registry repository, Docker format, in `europe-west2`                                                                    |
| `tps-<environment>-<cell>-github`  | Workload Identity pool, with one OIDC provider for `https://token.actions.githubusercontent.com`                                  |
| `publisher`                        | Pushes to that repository and does nothing else                                                                                   |
| `deployer`                         | Reads that repository and Cloud Run's operations; the services root grants it its rights on each workload it deploys              |
| Three custom roles                 | `deploy` (read a workload and change its image), `run_job` (run a job and follow it) and `read_operations` (`run.operations.get`) |

The provider admits a token only from the repository with the id you give,
and only from one of two GitHub environments:

- `release`, on a `vX.Y.Z` tag. Only this environment may act as the
  publisher.
- The one named for this root's environment, `staging` here. Only it may act
  as the deployer.

The deployer may change the image of the api, console and portal services,
the worker pool and the migrate job, run the migrate job, and act as those
five workloads' service accounts. It holds nothing on the tenant-create job
or the backup job, or on their service accounts, so it can neither run nor
change them; an operator rolls each out by applying its root. It holds no
role on the project except `read_operations`, since an operation has no IAM
of its own.

The registry's tags are not immutable, because cosign writes each digest's
signature and attestations under tags of their own. Workloads always run an
image by digest.

## Apply

```sh
export TF_VAR_project=<project id> TF_VAR_environment=staging TF_VAR_cell=uk
export TF_VAR_repository_id=<the repository's numeric id>
tofu -chdir=infra/terraform/gcp/release init \
  -backend-config="bucket=<state bucket>" \
  -backend-config="prefix=$TF_VAR_environment/$TF_VAR_cell/release"
tofu -chdir=infra/terraform/gcp/release apply
```

`gh api repos/<owner>/<repository> --jq .id` prints the repository's id. An
id, unlike a name, cannot be taken by someone who renames a repository.

Then, in the repository's settings on GitHub:

| What                  | Value                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Environment `release` | Deployment tags `v*.*.*` only                                                                                                |
| Environment `staging` | Required reviewer: the repository owner                                                                                      |
| Variables             | `TPS_RELEASE_REGISTRY`, `TPS_WIF_PROVIDER`, `TPS_PUBLISHER` and `TPS_DEPLOYER` from the outputs below, and `TPS_GCP_PROJECT` |

| Output                       | GitHub variable        |
| ---------------------------- | ---------------------- |
| `registry`                   | `TPS_RELEASE_REGISTRY` |
| `workload_identity_provider` | `TPS_WIF_PROVIDER`     |
| `publisher`                  | `TPS_PUBLISHER`        |
| `deployer`                   | `TPS_DEPLOYER`         |

None of them is a secret. The workflow's sign-in step, in the first tag's
build, is the check that this root is right.

This root is applied for staging. Production will pull the same signed
digests rather than build its own, so its promotion is a later change.

## Rolling back

Re-apply the previous commit. A deleted pool or provider keeps its id for
30 days and cannot be re-created under it in that time, so to stop the
workflow signing in, disable the provider rather than delete it. The repository holds every release: deleting it
loses the signed images the workloads run.
