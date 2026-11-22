# Edge root

The cell's external Application Load Balancer, which maps the self-hosted
proxy's rules ([ADR 0030](../../../../docs/adr/0030-files-and-reverse-proxy.md))
onto Google Cloud. Nothing else in the cell takes traffic from the internet.

| What             | Rule                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Hosts            | The console and portal hosts only. Any other host gets 404 from the load balancer and reaches no backend       |
| Routes           | Under each host, `/api/` goes to the API and the rest to that host's web app. Nothing routes to Cloud Storage  |
| Forwarding       | Each host drops `Forwarded` and `X-Real-IP` and replaces `X-Forwarded-Host` with the host it matched           |
| TLS              | A Google-managed certificate for both hosts, TLS 1.2 or later; port 80 only redirects to HTTPS                 |
| Response headers | `Strict-Transport-Security: max-age=63072000; includeSubDomains`, and nothing else added                       |
| Request log      | Off: it would record query strings, which can hold tokens                                                      |
| Cloud Armor      | On the API: 30 uploads a minute and 200 requests in 10 seconds per client address, then 429                    |
| Invoking         | `allUsers` may invoke api, console and portal, which still take traffic only from the project's load balancers |

The services are serverless network endpoint groups, so they take Cloud Run's
request timeout, not a backend service timeout: the services root sets the
API's to 150 seconds, as the proxy's. Cloud Armor counts over fixed windows
with no burst, cannot count uploads at once, and adds no `Retry-After`; the
API's own limits cover those.

Check these against Google's documentation before the first apply, and
correct this page if any has changed: that a URL map's default route can
abort with 404 through fault injection while its hosts' routes reach
serverless backends; and that Cloud Armor's rule language has
`request.path.endsWith`.

## Before you apply

- The services root is applied, so `api`, `console` and `portal` exist.
- You control DNS for both hosts.

Inputs are the services root's own:

```sh
export TF_VAR_project=<project id> TF_VAR_environment=staging TF_VAR_cell=uk
export TF_VAR_console_origin=https://<console host> TF_VAR_portal_origin=https://<portal host>
tofu -chdir=infra/terraform/gcp/edge init \
  -backend-config="bucket=<state bucket>" \
  -backend-config="prefix=$TF_VAR_environment/$TF_VAR_cell/edge"
tofu -chdir=infra/terraform/gcp/edge apply
```

## After you apply

1. Point both hosts at the `address` output with `A` records.
2. Wait for the certificate to become active, which needs those records:
   `gcloud compute ssl-certificates list --global` shows its status.
3. Set `TF_VAR_api_trust_proxy` to the `api_trust_proxy` output and re-apply
   the services root, so the API reads the client's address through this
   load balancer.

A change of host makes a new certificate, named for its hosts, before the
old one is removed, so update the `A` records and both roots' origins
together.

## Checks

```sh
tofu -chdir=infra/terraform fmt -check -recursive
tofu -chdir=infra/terraform/gcp/edge init -backend=false -lockfile=readonly
tofu -chdir=infra/terraform/gcp/edge validate
tofu -chdir=infra/terraform/gcp/edge test
trivy config --severity HIGH,CRITICAL --exit-code 1 infra/terraform/gcp/edge
```

## Rolling back

Re-apply the previous commit. To take the cell off the internet at once,
destroy this root: the services stay, unreachable, with their data.
