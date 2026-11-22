# Helm chart

This chart installs Fairfold Grants on any Kubernetes cluster that follows
the standard, from the same signed images CI builds. It runs with the same
guards as the Compose stack (`infra/compose/compose.stack.yaml`): secrets
reach each process as files, a migrate job runs before every install and
upgrade, every pod runs with the fewest privileges it needs, and network
policies stop the API and worker reaching anything but the services they
name.

Install one release per cell ([ADR 0012](../../docs/adr/0012-hosting-targets-and-cells.md)),
in a namespace of its own. The proxy and web images reach the API by the
name `api`, so the chart's object names are fixed and two releases cannot
share a namespace.

## What it installs

| Workload  | Image   | What it does                                                                                                                                                           |
| --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrate` | api     | A Job before every install and upgrade: the roles script, then the migrations. If it fails, the rollout stops                                                          |
| `api`     | api     | The API, on port 3000, reached only through the edge                                                                                                                   |
| `worker`  | api     | Background jobs. It opens no port, so it has no Service and no probe                                                                                                   |
| `console` | console | The staff console's web server                                                                                                                                         |
| `portal`  | portal  | The applicant portal's web server                                                                                                                                      |
| `edge`    | edge    | The reverse proxy from `infra/proxy/`: TLS, HSTS, compression, logs, rate limits and the one upload route ([ADR 0030](../../docs/adr/0030-files-and-reverse-proxy.md)) |

Every pod runs as user and group 1000 with a read-only root file system, no
capabilities, no privilege escalation, the runtime's default seccomp profile
and no service account token. Each has a service account of its own with no
role bindings, and the restricted Pod Security profile accepts all of them.

The chart creates no Secret and bundles no database, storage, mail relay or
virus scanner.

## What you provide

- **Kubernetes 1.34 or later**, with a network plugin that enforces
  NetworkPolicy, ingress and egress. Without one, the policies below do
  nothing. Some plugins do not apply egress policy to the node a pod runs
  on, so keep the chart's pods off control-plane nodes, and on a
  single-node cluster do not rely on the policies alone. CI checks the
  chart against Kubernetes 1.34.
- **PostgreSQL 16 or later**, with TLS. The migrate job connects either as a
  true superuser or, on a managed service, as its admin role
  (`database.adminMode: managed`).
- **S3-compatible storage**, with one key pair for each purpose: write, read,
  scanner and removal ([ADR 0047](../../docs/adr/0047-file-uploads.md)).
- **An SMTP relay** that offers STARTTLS or TLS.
- **clamd**, with ADR 0047's limits.
- **The images**, by digest. Set the repository and `sha256:` digest of
  each; a tag alone is refused. The edge image is built from
  `infra/proxy/Dockerfile`.
- **A certificate** for the console and portal host names.

## Secrets

Create each Secret in the release's namespace before you install, and name
it in `values.yaml` under `secrets`. Each holds its value under the key
`value`, except `edgeTls`, which is a `kubernetes.io/tls` Secret. The schema
refuses an install that leaves one out.

| Value                     | Mounted by      | What it is                                                        |
| ------------------------- | --------------- | ----------------------------------------------------------------- |
| `databaseAdminPassword`   | migrate         | The superuser's password, or the managed admin's                  |
| `migratorPassword`        | migrate         | The `migrator` role's password                                    |
| `appApiPassword`          | migrate, api    | The `app_api` role's password                                     |
| `appAuthPassword`         | migrate, api    | The `app_auth` role's password                                    |
| `appWorkerPassword`       | migrate, worker | The `app_worker` role's password                                  |
| `appQueuePassword`        | migrate, worker | The `app_queue` role's password                                   |
| `backupReaderPassword`    | migrate         | The `backup_reader` role's password                               |
| `authSecret`              | api             | Seals sessions and tokens; at least 32 random bytes               |
| `requestLimitKey`         | api             | Keys the request limit counters                                   |
| `subjectKek`              | api, worker     | Wraps each data subject's key; its version is `subjectKekVersion` |
| `storageWriteSecretKey`   | api, worker     | The write key pair's secret                                       |
| `storageReadSecretKey`    | api, worker     | The read key pair's secret                                        |
| `storageScannerSecretKey` | api, worker     | The scanner key pair's secret                                     |
| `storageRemovalSecretKey` | worker          | The removal key pair's secret                                     |
| `smtpPassword`            | api, worker     | Only with `smtp.user`, for a relay that needs a login             |
| `edgeTls`                 | edge            | The certificate and key for the two host names                    |

Each pod mounts only its own, as files under `/run/secrets`, readable by
group 1000 and no one else. A Secret per value means a node only ever holds
the secrets of the pods it runs. The database CA, and any extra CA for a
private mail relay, come from ConfigMaps, since a certificate is not secret.

## Values that differ between cells

- `hosts.console` and `hosts.portal`, and `edge.httpsPort` if browsers do
  not reach the edge on 443.
- `database`, `storage`, `smtp` and `clamd`: where each service is, and the
  network policy peer that reaches it.
- `api.trustProxy`: the pod address ranges the edge runs in.
- `secrets`: the Secrets you made for this cell.

The images stay the same in every cell.

## Network policies

Every pod is denied all traffic in and out, then allowed only this:

| Pod     | In                       | Out                                                                  |
| ------- | ------------------------ | -------------------------------------------------------------------- |
| migrate | nothing                  | DNS, PostgreSQL                                                      |
| api     | the edge, on 3000        | DNS, PostgreSQL, storage, SMTP, clamd, and HTTPS to public addresses |
| worker  | nothing                  | DNS, PostgreSQL, storage, SMTP, clamd                                |
| console | the edge, on 8080        | DNS                                                                  |
| portal  | the edge, on 8080        | DNS                                                                  |
| edge    | anyone, on 8080 and 8443 | DNS, the API, the console and the portal                             |

Public addresses leave out metadata, private, shared, loopback and reserved
ranges. For IPv6 they are global unicast addresses (`2000::/3`) only, less
Teredo (`2001::/32`), the documentation range (`2001:db8::/32`) and 6to4
(`2002::/16`), so IPv4-mapped, NAT64, unique local, link-local and loopback
addresses are left out. The API's outbound client checks every address too;
the policies are a second layer
([ADR 0010](../../docs/adr/0010-authentication-security-rules.md)).

Some network plugins, kind's among them, do not apply egress policy to the
node a pod runs on. A pod may then reach its own node's kubelet, and on a
control-plane node the Kubernetes API server too, whatever its policy says.
Keep the chart's pods off control-plane nodes (their usual taint does
this). On a single-node cluster, such as a small k3s install, do not rely
on the policies alone: a firewall on the node must stop pods reaching it.

Each named service takes one of three peers:

```yaml
# Pods in this cluster.
networkPolicy: { namespace: databases, podLabels: { app: postgres }, port: 5432 }
# One address outside the cluster, such as a managed database in a private range.
networkPolicy: { cidr: 10.20.30.40/32, port: 5432 }
# Public addresses only, such as a hosted mail relay.
networkPolicy: { public: true, port: 587 }
```

An address must be a single one, `/32` or `/128`, so a value cannot open a
private range. The port is the one the server or pod listens on, not a
Service's port. A node-local DNS cache on a link-local address is not
reached; point `dns` at the cluster's DNS pods.

## The edge and the way in

The edge is the only way in, and the API believes the client address it
forwards, so it must see each client's own address: its rate limits count
per address. The options:

1. **Recommended: the edge as the entry point.** Set `edge.service.type` to
   `LoadBalancer` (or `NodePort` behind your own load balancer). The chart
   then sets `externalTrafficPolicy: Local`, so the edge sees each client's
   address, and the edge terminates TLS with your certificate. Add any
   annotations your load balancer needs under `edge.service.annotations`.
2. **An Ingress that passes TLS through to the edge.** This keeps the edge's
   TLS, but how to pass TLS through is particular to each ingress
   controller, and the edge then sees the controller's address, not the
   client's, unless the controller sends the PROXY protocol, which the edge
   does not accept yet.
3. **An Ingress that terminates TLS and re-encrypts to the edge.** The
   certificate then sits in two places, and the edge would have to trust the
   controller's forwarded address, a change to `infra/proxy/`.

The chart builds option 1 only.

## Where the images come from

Release images are signed with cosign and carry SPDX and CycloneDX SBOMs
(`.github/workflows/release.yml`). Where they are published for
self-hosters is not decided yet. Verify each digest before you install:

```sh
cosign verify <repository>@<digest> \
  --certificate-identity https://github.com/<owner>/<repository>/.github/workflows/release.yml@refs/tags/<tag> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Install

```sh
helm install tps infra/helm --namespace <namespace> --values <your values file>
```

`helm upgrade` with the same values runs the migrate job again before it
changes anything. The migrate job's ServiceAccount and network policy are
hooks, so `helm uninstall` leaves them, and the Job, in the namespace.

The self-hosting hardening guide covers the rest: backups, monitoring,
rotating secrets and the cluster's own security.

## Tests

`infra/helm/ci/test.sh` runs the CI job's steps: lint, render, schema
checks, kubeconform and Trivy, then an install and an upgrade on kind with
images from a local registry, and checks of the secret mounts and network
policies from inside the pods. `infra/helm/ci/` also holds the kind
configuration, the CI values and the test-only services.
