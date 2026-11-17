# Infrastructure

OpenTofu configuration for the managed service
([ADR 0015](../../docs/adr/0015-opentofu.md)). Cloud specifics live only here
([architecture rule 1](../../docs/ARCHITECTURE.md)). Each target has its own
folder of roots, and each root takes an `environment` and a `cell`
([ADR 0012](../../docs/adr/0012-hosting-targets-and-cells.md)), so production
reuses the staging code with its own state.

| Path             | What it creates                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `gcp/state/`     | The Cloud Storage bucket that holds the other roots' state                                     |
| `gcp/network/`   | The VPC, the Cloud Run subnet, private services access, a deny-all ingress rule and Cloud NAT  |
| `gcp/database/`  | Cloud SQL for PostgreSQL 16, private and encrypted only, its DNS name and the operators' group |
| `modules/gcp-*/` | The Google Cloud modules those roots call                                                      |

Every resource is named `tps-<environment>-<cell>-…`, and every resource that
takes labels carries `environment` and `cell`.

## Before you start

- OpenTofu 1.13.1, obtained as ADR 0015 sets out.
- Your own Google credentials: `gcloud auth application-default login`.
  Nothing applies from CI.
- One Google Cloud project per environment and cell, and a Google group for
  the operators who run the roles script and migrations.

Inputs are passed as environment variables, so no project id, bucket name or
`.tfvars` file is ever written to the repository:

```sh
export TF_VAR_project=<project id> TF_VAR_environment=staging TF_VAR_cell=uk
```

## Create the state bucket (once per project)

This root keeps its own state on your machine, outside the repository. It
holds one bucket; if the file is lost, `tofu import` brings the bucket back.

```sh
tofu -chdir=infra/terraform/gcp/state init
tofu -chdir=infra/terraform/gcp/state apply -state="$HOME/tps-state/$TF_VAR_environment-$TF_VAR_cell.tfstate"
```

The `bucket` output is the state bucket for the other roots.

## Apply the network, then the database

Each root keeps its state in that bucket under its own prefix:

```sh
for root in network database; do
  tofu -chdir=infra/terraform/gcp/$root init \
    -backend-config="bucket=<bucket output>" \
    -backend-config="prefix=$TF_VAR_environment/$TF_VAR_cell/$root"
done
tofu -chdir=infra/terraform/gcp/network apply
TF_VAR_operators_group=<group email> tofu -chdir=infra/terraform/gcp/database apply
```

The database root finds the network by its name, so apply the network first.

## Connecting to the database

The apps and scripts connect with standard PostgreSQL TLS, through their
existing settings, so the same code runs on any provider:

| Setting         | Value                                       |
| --------------- | ------------------------------------------- |
| `TPS_DB_HOST`   | The database root's `host` output           |
| `TPS_DB_TLS`    | `verify-full`                               |
| `TPS_DB_TLS_CA` | The database root's `ca_certificate` output |

The instance has no public address and accepts only encrypted connections.
Its server certificate names `host`, which resolves to the private address
inside the VPC only, so clients run inside the cell's network.

Operators log in as their Google identity with a short-lived access token as
the password (IAM database authentication). The group is a member of
`cloudsqlsuperuser`, which the roles script's managed mode runs as
(`TPS_DB_ADMIN_MODE=managed`). The app roles' passwords are set by the roles
script, so no database password reaches OpenTofu state.

## Checks

Run before every pull request that changes this folder:

```sh
tofu -chdir=infra/terraform fmt -check -recursive
for root in state network database; do
  tofu -chdir=infra/terraform/gcp/$root init -backend=false
  tofu -chdir=infra/terraform/gcp/$root validate
done
tofu -chdir=infra/terraform/gcp/database test
trivy config --severity HIGH,CRITICAL --exit-code 1 infra/terraform
```

When the Google provider's version changes, update every root's lock file in
the same pull request:

```sh
tofu -chdir=infra/terraform/gcp/<root> providers lock \
  -platform=linux_amd64 -platform=darwin_arm64 -platform=windows_amd64
```

## Rolling back

Re-apply the previous commit. The database has deletion protection in both
OpenTofu and Cloud SQL, and the state bucket cannot be destroyed from code:
removing either takes a reviewed change that turns its protection off first.
A lost database is restored from its backups or a point in time
([ADR 0011](../../docs/adr/0011-backups-and-recovery.md)), never recreated
empty.
