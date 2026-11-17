# Go live with a managed cell

Use this page to take an empty Google Cloud project to a running Fairfold
Grants cell that staff can sign in to, with backups and alerts on. It follows
the code as it stands. Where the code does not yet do a step, the step says
**Not built yet** and says what to do by hand.

|                    |                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Who may run it** | An operator with owner rights on the project. One person runs it; a second reads each "Check" line.                   |
| **What you need**  | OpenTofu 1.13.1, `gcloud`, `age`, `pnpm` on Node.js 24, and a clone of the repository at the release you will deploy. |
| **How long**       | A day, mostly waiting for the database and for DNS.                                                                   |
| **Data**           | Synthetic data only. See [Before real personal data](#before-real-personal-data).                                     |

Every name below is `tps-<environment>-<cell>-...`. This page uses
`staging` and `uk`. Placeholders are in angle brackets. Never write a project
id, host name, address or password into the repository.

Set these once in your shell:

```sh
export TF_VAR_project=<project id> TF_VAR_environment=staging TF_VAR_cell=uk
```

## 1. Prepare the project

You need:

- A Google Cloud project, with billing linked, in the `europe-west2` region
  for everything.
- A Google group for the operators who run the roles script and migrations.
- A domain you control, with one host name each for the console and the
  portal.
- An SMTP provider that keeps mail in the UK or EU, with a sending address
  you control.
- A ClamAV service the cell can reach, as a host and port (3310).
- The off-site backup store at PeaSoup: a bucket with object lock and
  versioning on, and an access key for the job alone. Follow
  [Setting up the backup store](../../infra/backup/README.md#setting-up-the-backup-store).
- Your own Google sign-in: `gcloud auth application-default login`.

**Not built yet:** no OpenTofu root creates the release pipeline's Google
side. Create these by hand before the first tag, matching
`.github/workflows/release.yml`:

| What                                          | Rule                                                                                                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An Artifact Registry repository               | Docker format, in `europe-west2`                                                                                                                                                                                                               |
| A Workload Identity pool and an OIDC provider | Issuer `https://token.actions.githubusercontent.com`; accept only this repository                                                                                                                                                              |
| The publisher service account                 | Writes to that repository and nothing else; only the provider may impersonate it, and only for `v*.*.*` tags                                                                                                                                   |
| The deployer service account                  | Reads that repository, updates and runs the five workloads, and acts as their service accounts; nothing else                                                                                                                                   |
| GitHub environments `release` and `staging`   | `release` allows `v*.*.*` tags only; `staging` needs your approval for each run                                                                                                                                                                |
| GitHub variables                              | `TPS_RELEASE_REGISTRY` (`europe-west2-docker.pkg.dev/<project>/<repository>`), `TPS_WIF_PROVIDER` (`projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`), `TPS_PUBLISHER`, `TPS_DEPLOYER`, `TPS_GCP_PROJECT` |

Check: the pipeline's sign-in step, in step 3, passes. Nothing is stored in
GitHub as a secret for this.

## 2. Apply the OpenTofu roots

The roots are in `infra/terraform/gcp/`. Apply them in this order, because
each finds the one before it by name. Full detail for each is in
[the infrastructure README](../../infra/terraform/README.md) and the README
in each root. Nothing applies from CI.

### State

```sh
tofu -chdir=infra/terraform/gcp/state init
tofu -chdir=infra/terraform/gcp/state apply -state="$HOME/tps-state/$TF_VAR_environment-$TF_VAR_cell.tfstate"
```

Check: the `bucket` output names the state bucket. Keep that state file
safe, and keep the bucket readable by operators alone: later roots hold keys
in their state.

### Network and database

```sh
for root in network database; do
  tofu -chdir=infra/terraform/gcp/$root init \
    -backend-config="bucket=<state bucket>" \
    -backend-config="prefix=$TF_VAR_environment/$TF_VAR_cell/$root"
done
tofu -chdir=infra/terraform/gcp/network apply
TF_VAR_operators_group=<group email> tofu -chdir=infra/terraform/gcp/database apply
```

Check: the database root prints `host`, `ca_certificate` and
`connection_name`. The instance has no public address, so you reach it only
from inside the cell's network.

### Database roles

The roles script makes the database, sets each role's password and checks
the result. Run it from a machine inside the cell's network, as an operator,
with the database settings from
[the infrastructure README](../../infra/terraform/README.md#connecting-to-the-database)
and `TPS_DB_ADMIN_MODE=managed`:

```sh
node packages/db/scripts/db.ts prepare
```

Check: the command ends without an error. Save each role's password in a
file outside the repository. You need `app_api`, `app_auth`, `app_worker`,
`app_queue`, `migrator` and `backup_reader`. **Not built yet:** no job runs
this inside the cell, so the machine you use must be able to reach the
private address. Whether Cloud SQL lets its admin role give `backup_reader`
its row-security exemption is not yet known
([restore runbook](restore.md#restore-to-a-point-in-time), step 3).

### Services

The services root needs the release images, so push the first release tag
(step 3) before you apply it. Then set the inputs from
[its README](../../infra/terraform/gcp/services/README.md#before-you-apply):
`TF_VAR_images`, `TF_VAR_console_origin`, `TF_VAR_portal_origin`,
`TF_VAR_api_trust_proxy`, `TF_VAR_clamd` and `TF_VAR_smtp`. Then:

```sh
tofu -chdir=infra/terraform/gcp/services init \
  -backend-config="bucket=<state bucket>" \
  -backend-config="prefix=$TF_VAR_environment/$TF_VAR_cell/services"
tofu -chdir=infra/terraform/gcp/services apply -target=google_secret_manager_secret.secret
gcloud secrets versions add tps-staging-uk-auth-secret --data-file=<file>
```

Add a version to each secret in the table in that README, from files outside
the repository. Escrow `auth-secret` and `subject-kek` as
[ADR 0011](../adr/0011-backups-and-recovery.md) says before you go on: a
lost key cannot be recovered. Then:

```sh
tofu -chdir=infra/terraform/gcp/services apply
gcloud run jobs execute tps-staging-uk-migrate --region=europe-west2 --wait
```

Check: the migrate job finishes with all tasks succeeded, and
`gcloud run services list --region=europe-west2` shows `api`, `console` and
`portal`. They are not reachable from the internet yet (see step 4).

### Monitoring

```sh
export TF_VAR_alert_email=<operators' mailbox>
tofu -chdir=infra/terraform/gcp/monitoring init \
  -backend-config="bucket=<state bucket>" \
  -backend-config="prefix=$TF_VAR_environment/$TF_VAR_cell/monitoring"
tofu -chdir=infra/terraform/gcp/monitoring apply
```

Check: Cloud Monitoring shows the dashboards Jobs, Requests and Security
events, and one alert policy for each rule in
`infra/observability/alerts/tps.rules.yaml`. Confirm the mailbox receives
Google's channel verification email.

### Backup

Read [the backup root's README](../../infra/terraform/gcp/backup/README.md)
first. Two things in it stop you:

- **Not built yet:** the network root does not create the private DNS zone
  for Google APIs. Do not apply the backup root until it exists.
- **Not built yet:** no pipeline builds the backup image, so you build and
  push it by hand. It needs `pg_dump`, `psql`, `age` and `aws` in
  `/usr/local/bin`, and runs as a non-root user.

Then, with `TF_VAR_backup_project`, `TF_VAR_image`, `TF_VAR_backup_store` and
`TF_VAR_key_id` set as its README says:

```sh
tofu -chdir=infra/terraform/gcp/backup init \
  -backend-config="bucket=<state bucket>" \
  -backend-config="prefix=$TF_VAR_environment/$TF_VAR_cell/backup"
tofu -chdir=infra/terraform/gcp/backup apply -target=google_secret_manager_secret.secret
gcloud secrets versions add tps-staging-uk-backup-db-password --data-file=<file>
tofu -chdir=infra/terraform/gcp/backup apply
```

Also add versions to `backup-store-credentials` and `backup-recipients`.
Check: the plan shows the scheduler job `tps-staging-uk-backup` at 01:30 UTC.
The job does not write to the Google archive yet, so the archive stays empty.

## 3. Tag the first release

Only the repository owner pushes tags. The tag is `vX.Y.Z` and nothing else.

```sh
git tag v0.1.0
git push origin v0.1.0
```

What the pipeline does ([the release workflow](../../.github/workflows/release.yml)):

1. **Build** (the `release` environment). It builds the API, console and
   portal images from the tagged commit, pushes them to the registry, scans
   each digest, signs it and attaches software bills of materials. A high or
   critical finding stops the run.
2. **Promote** (the `staging` environment). You approve the run. It verifies
   each digest's signature and attestations, updates the migrate job to the
   new API image and runs it, and only if that succeeds rolls out the API,
   worker, console and portal to the same digests.

Check: the run's summary lists `$TAG in staging` with the three digests.
Copy those digests into `TF_VAR_images` for the services root, so OpenTofu
and the pipeline agree. To promote the same tag again without building, run
the workflow by hand with the tag. To roll back, follow the comment at the
top of the workflow and
[the services README](../../infra/terraform/gcp/services/README.md#rolling-back).

The `staging` environment holds no traffic yet. Check in main's history that
the items named at the top of the workflow have merged before you approve the
first promotion.

## 4. DNS and TLS

**Not built yet:** no root creates the load balancer, its certificate or its
Cloud Armor rules ([ADR 0030](../adr/0030-files-and-reverse-proxy.md)). The
services accept traffic from the load balancer only and have no `run.app`
address, so until it exists nobody can open the console. When it is built:

1. Point the console and portal host names at the load balancer's address
   with `A` records at your DNS provider.
2. Use a Google-managed certificate for both names.
3. Set `TF_VAR_api_trust_proxy` to the load balancer's addresses and
   Google's front-end ranges, and re-apply the services root.

Check: `https://<console host>` loads the sign-in page with a valid
certificate.

## 5. Create the first tenant and administrator

The command is `pnpm tenant:create`
([ADR 0019](../adr/0019-tenant-addresses-public-pages-and-theming.md)):

```sh
pnpm tenant:create --slug harbour-trust --name "Harbour Trust" --admin-email admin@example.org
```

A slug is 3 to 40 lower case letters, numbers and single hyphens, starting
with a letter. Add `--modules <id,id>` to switch tools on; with none, every
tool is off. The command connects as `app_worker`, so it needs the database
settings and `TPS_CONSOLE_ORIGIN`, `TPS_SMTP_*` as in step 2. It prints the
tenant's id and slug and never a link or a token.

**Not built yet:** the script `pnpm tenant:create` supplies its settings for
the development database only. On the managed service, run
`node apps/api/src/operator/create-tenant.ts` with the same arguments and
those settings in the environment, from a machine inside the cell's network.
No Cloud Run job does it for you.

Check: the command prints "Invited the first administrator by email." The
administrator opens the link within 7 days, sets a password and an
authenticator app, and accepts. If it prints "The first administrator has not
been invited", the tenant exists: fix the mail or database settings and
invite from **Team** once someone can sign in, or ask the operator to run the
command again with a new slug. See [Team and roles](../admin/team-and-roles.md).

## 6. SMTP and sender settings

Mail settings belong to the cell, not to each tenant. They are the `smtp`
input of the services root: `host`, `port`, `tls` (`starttls` or `tls`;
plain SMTP is refused), `user` and `from`, plus the `smtp-password` secret.
Every tenant's mail comes from that one `from` address.

To change them, edit the input, re-apply the services root and add a new
version of `smtp-password` if the password changed.

Check: invite a second team member from **Team**. The email arrives, comes
from the `from` address and the link opens the console. Set up SPF and DKIM
for the sending domain at your DNS provider so the mail is not filtered as
spam.

## 7. First backup and a restore check

Run the job once by hand:

```sh
gcloud run jobs execute tps-staging-uk-backup --region=europe-west2 --wait
```

Check: the job exits with success, and the newest run record in the backup
store's `runs/` prefix has outcome `ok`. The missed-backup alert stays on
until this first complete run. A re-run on the same day stops with
`already_complete`, which is also fine.

Then prove you can restore. Follow
[Restore the service from a backup](restore.md) into a new, empty instance
with synthetic data, and keep the restore record. The restore command that
ADR 0011 describes does not exist yet, so the by-hand steps apply. Until a
restore has worked once, treat every recovery time as a target.

## 8. What to watch

Open Cloud Monitoring's dashboards:

| Dashboard       | Watch for                                                                        |
| --------------- | -------------------------------------------------------------------------------- |
| Requests        | Server errors above zero for a few minutes; response time over the 500 ms target |
| Jobs            | Jobs waiting that do not fall; any dead-lettered job                             |
| Security events | Spikes in sign-in or second-factor failures                                      |

Alerts go to the mailbox you set. Each alert's text names a runbook under
`docs/runbooks/`. **Not built yet:** `audit-copy.md`, `dead-letter.md`,
`incident.md` and `lockout.md` do not exist yet, and the Collector that sends
the cell's metrics to Cloud Monitoring is not built, so the dashboards may
stay empty. Until then, read the Cloud Run logs for the API and worker.

Also watch for a missed backup (no complete run for 26 hours), and for
[rotating secrets](secret-rotation.md) on your schedule.

## Before real personal data

Do not put real applicant or grantee data in this cell yet. It is a
demonstration on synthetic data. The Gate 1 items below must be done first,
and some are the operator's to provide, not the software's:

- An independent penetration test, with high findings fixed.
- Cyber Essentials Plus certification.
- A data protection impact assessment, and a data processing agreement signed
  with each funder.
- A restore from backup, tested (step 7).
- A manual WCAG 2.2 AA audit of the applicant journey.
- A second engineer's review of the code, and the open security-review fixes.

The code provides tenant isolation, an append-only audit log, encrypted
backups and signed releases. It does not provide the certifications, the
agreements, the escrow of keys or the choice of who may act as operator.

## Related pages

- [Restore the service from a backup](restore.md)
- [Rotate the auth secret and other secrets](secret-rotation.md)
- [Move a tenant to another cell](tenant-move.md)
- [Self-hosting quickstart](../self-hosting/quickstart.md)
