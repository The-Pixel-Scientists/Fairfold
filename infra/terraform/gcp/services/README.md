# Services root

The cell's workloads on Cloud Run, the files bucket and the secrets they
mount, each with its own service account
([ADR 0015](../../../../docs/adr/0015-opentofu.md),
[ADR 0012](../../../../docs/adr/0012-hosting-targets-and-cells.md)).

| Workload  | Runs as                                        | Database role                | Ingress                   |
| --------- | ---------------------------------------------- | ---------------------------- | ------------------------- |
| `api`     | Cloud Run service, API image                   | `app_api` and `app_auth`     | The load balancer only    |
| `console` | Cloud Run service, web image                   | None                         | The load balancer only    |
| `portal`  | Cloud Run service, web image                   | None                         | The load balancer only    |
| `worker`  | Cloud Run worker pool, API image, one instance | `app_worker` and `app_queue` | None                      |
| `migrate` | Cloud Run job, API image                       | `migrator`                   | None; an operator runs it |

The worker is a worker pool because it opens no port, and a Cloud Run
service must answer on one to start. Every workload sends all its traffic
through the cell's VPC and reaches Cloud SQL at its private address with
`TPS_DB_TLS=verify-full`. No service account holds a project-level role.

No one may invoke the services yet, and they have no `run.app` address, so
applying this root makes nothing reachable. The load balancer, with its
Cloud Armor rules and the public invoker binding it needs
([ADR 0030](../../../../docs/adr/0030-files-and-reverse-proxy.md)), comes
with the first rollout.

## Files

The apps speak S3 ([architecture rule 1](../../../../docs/ARCHITECTURE.md)),
so they reach the bucket through Cloud Storage's S3-compatible API,
path-style, at `https://storage.googleapis.com`. Each of ADR 0030's key
purposes is an HMAC key on its own service account, granted on this bucket
only and only under its prefixes, as the stack's SeaweedFS identities are:

| Key       | May                                                                                | Held by        |
| --------- | ---------------------------------------------------------------------------------- | -------------- |
| `write`   | Create objects under `clean/`                                                      | API and worker |
| `read`    | Read objects under `clean/`                                                        | API and worker |
| `scanner` | Read `clean/` and `withheld/`, create under `withheld/`                            | API and worker |
| `removal` | List, head and delete under `clean/` and `withheld/`, read the bucket's versioning | Worker         |

Code creates each key and writes its secret straight to Secret Manager; it is
never an output. It is held in this root's state, so the state bucket must
stay readable by operators alone. To rotate a key:

```sh
tofu -chdir=infra/terraform/gcp/services apply -replace='google_storage_hmac_key.files["write"]'
```

The bucket has no versioning and no soft delete: a delete removes the only
copy, and the sweep refuses to run on a versioned bucket (ADR 0030,
[ADR 0011](../../../../docs/adr/0011-backups-and-recovery.md)). The off-site
snapshot is the only second copy of a file.

## Before you apply

- The network and database roots are applied, and the roles script has run
  in managed mode (`TPS_DB_ADMIN_MODE=managed`), creating the database and
  setting each role's password.
- The release images are in a registry the project can pull from.
- A ClamAV service and an in-jurisdiction SMTP relay the cell can reach.

Inputs come from the environment, as for the other roots. The objects are
HCL, and no value here is a secret:

```sh
export TF_VAR_project=<project id> TF_VAR_environment=staging TF_VAR_cell=uk
export TF_VAR_images='{ api = "<registry>/api@sha256:<digest>", console = "<registry>/console@sha256:<digest>", portal = "<registry>/portal@sha256:<digest>" }'
export TF_VAR_console_origin=https://<console host> TF_VAR_portal_origin=https://<portal host>
export TF_VAR_api_trust_proxy=<the load balancer's addresses and Google's front-end ranges>
export TF_VAR_clamd='{ host = "<host>", port = 3310 }'
export TF_VAR_smtp='{ host = "<host>", port = 587, tls = "starttls", user = "<user>", from = "<address>" }'
```

## Apply

The workloads cannot start until their secrets have values, so create the
secrets first, add the values, then apply the rest:

```sh
tofu -chdir=infra/terraform/gcp/services init \
  -backend-config="bucket=<state bucket>" \
  -backend-config="prefix=$TF_VAR_environment/$TF_VAR_cell/services"
tofu -chdir=infra/terraform/gcp/services apply -target=google_secret_manager_secret.secret
```

Add a version to each of these secrets, named
`tps-<environment>-<cell>-<name>`, from a file outside the repository:

| Secret                   | Setting it fills                  | Value                                                  |
| ------------------------ | --------------------------------- | ------------------------------------------------------ |
| `db-app-api-password`    | `TPS_DB_APP_API_PASSWORD_FILE`    | The password the roles script set for `app_api`        |
| `db-app-auth-password`   | `TPS_DB_APP_AUTH_PASSWORD_FILE`   | The same, for `app_auth`                               |
| `db-app-worker-password` | `TPS_DB_APP_WORKER_PASSWORD_FILE` | The same, for `app_worker`                             |
| `db-app-queue-password`  | `TPS_DB_APP_QUEUE_PASSWORD_FILE`  | The same, for `app_queue`                              |
| `db-migrator-password`   | `TPS_DB_MIGRATOR_PASSWORD_FILE`   | The same, for `migrator`                               |
| `auth-secret`            | `TPS_AUTH_SECRET_FILE`            | A new random secret, escrowed as ADR 0011 says         |
| `request-limit-key`      | `TPS_REQUEST_LIMIT_KEY_FILE`      | A new random key                                       |
| `subject-kek`            | `TPS_SUBJECT_KEK_FILE`            | A new random key, version 1, escrowed as ADR 0011 says |
| `smtp-password`          | `TPS_SMTP_PASSWORD_FILE`          | The relay's password                                   |

```sh
gcloud secrets versions add tps-staging-uk-auth-secret --data-file=<file>
```

`db-ca` and the four `storage-*` secrets are filled from code. Then:

```sh
tofu -chdir=infra/terraform/gcp/services apply
gcloud run jobs execute tps-staging-uk-migrate --region=europe-west2 --wait
```

Cloud Run sets `PORT` and variables starting `K_` or `CLOUD_RUN_` of its own.
None starts `TPS_`, and none is a proxy variable, which the API and worker
refuse ([ADR 0010](../../../../docs/adr/0010-authentication-security-rules.md)).

## Rolling back

- A service: send its traffic back to the previous revision,
  `gcloud run services update-traffic <service> --region=europe-west2 --to-revisions=<revision>=100`,
  then re-apply with the previous image digest so code and the service agree.
- The worker: re-apply with the previous image digest.
- A migration: run the migrate job as `pnpm db:rollback` runs, as the
  migrator, one migration at a time:
  `gcloud run jobs execute tps-staging-uk-migrate --region=europe-west2 --wait --args=node,packages/db/scripts/db.ts,down`.
- Anything else: re-apply the previous commit. The files bucket cannot be
  destroyed from code.
