#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The helm CI job (.github/workflows/ci.yml), step for step. It checks the
# chart, then installs it on a kind cluster against the services in
# fixtures.yaml, with images built as the stack builds them and pushed to a
# local registry, so the chart runs by real digests. Every secret,
# certificate and key is made here for the run and never leaves it.
#
#   KUBERNETES_VERSIONS='1.34.0' REGISTRY_IMAGE='<image>@sha256:<digest>' infra/helm/ci/test.sh
#
# Needs helm, kind, kubectl, kubeconform, trivy, docker, openssl, jq, curl
# and Node.js on PATH. It uses a kubeconfig of its own, and deletes its
# cluster and registry when it ends.

set -euo pipefail

: "${KUBERNETES_VERSIONS:?Set KUBERNETES_VERSIONS to the versions to validate against.}"
: "${REGISTRY_IMAGE:?Set REGISTRY_IMAGE to the registry image, pinned by digest.}"

cd "$(git rev-parse --show-toplevel)"
chart=infra/helm
values=infra/helm/ci/values.yaml
namespace=tps
fixtures=tps-fixtures
cluster=tps-ci
registry=tps-ci-registry
work=$(mktemp -d)
export KUBECONFIG="$work/kubeconfig"
umask 077

cleanup() {
  status=$?
  if [ "$status" -ne 0 ] && [ -f "$KUBECONFIG" ]; then
    kubectl get pods,jobs --all-namespaces --output wide || true
    for workload in deploy/api deploy/worker deploy/edge job/migrate; do
      kubectl logs --namespace "$namespace" "$workload" --all-containers --tail 100 || true
    done
  fi
  kind delete cluster --name "$cluster" > /dev/null 2>&1 || true
  docker rm --force "$registry" > /dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "$*" >&2
  exit 1
}
[[ "$REGISTRY_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] \
  || fail 'REGISTRY_IMAGE must name its digest: <image>@sha256:<digest>.'

echo '--- Generate the secrets and certificates'
mkdir "$work/secrets"
secret_names=(
  database-admin-password migrator-password app-api-password app-auth-password
  app-worker-password app-queue-password backup-reader-password auth-secret
  request-limit-key subject-kek storage-write-secret-key storage-read-secret-key
  storage-scanner-secret-key storage-removal-secret-key
)
for name in "${secret_names[@]}" storage-admin-secret-key; do
  openssl rand -base64 32 | tr -d '=\n' | tr '+/' '-_' > "$work/secrets/$name"
done

cd "$work"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -noenc -days 1 \
  -subj '/CN=CI certificate authority' -keyout ca.key -out ca.crt \
  -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign' 2> /dev/null
issue() {
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -noenc \
    -subj "/CN=$1" -keyout "$1.key" -out "$1.csr" 2> /dev/null
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$2" > "$1.ext"
  openssl x509 -req -in "$1.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -days 1 \
    -extfile "$1.ext" -out "$1.crt" 2> /dev/null
}
issue postgres "DNS:postgres.$fixtures.svc.cluster.local"
issue mailpit "DNS:mailpit.$fixtures.svc.cluster.local"
issue edge 'DNS:console.tps.test,DNS:portal.tps.test'
cd - > /dev/null

echo '--- Lint and render the chart'
# The oldest supported version, which Chart.yaml's kubeVersion allows.
oldest=${KUBERNETES_VERSIONS%% *}
helm lint --strict "$chart" --values "$values" --kube-version "$oldest"
helm template tps "$chart" --values "$values" --namespace "$namespace" --kube-version "$oldest" \
  > "$work/rendered.yaml"

for version in $KUBERNETES_VERSIONS; do
  kubeconform -strict -summary -kubernetes-version "$version" "$work/rendered.yaml"
done
# Trivy skips a chart it cannot render with only a log line, so the scan
# must also show it read the templates.
trivy config --quiet --exit-code 1 --severity HIGH,CRITICAL --format json \
  --output "$work/trivy.json" --helm-values "$values" --helm-kube-version "$oldest" "$chart"
jq --exit-status '[.Results[]? | select(.Type == "helm")] | length >= 6' "$work/trivy.json" \
  > /dev/null || fail 'Trivy did not render the chart.'

if grep --quiet --line-regexp 'kind: Secret' "$work/rendered.yaml"; then
  fail 'The chart renders a Secret.'
fi
for name in "${secret_names[@]}"; do
  if grep --quiet --fixed-strings --file "$work/secrets/$name" "$work/rendered.yaml"; then
    fail "The rendered chart holds the value of $name."
  fi
done
if grep --quiet --ignore-case --extended-regexp '(https?|no|all)_proxy|node_use_env_proxy' "$work/rendered.yaml"; then
  fail 'The rendered chart sets a proxy variable.'
fi

# The schema refuses each of these. --set-json replaces a whole peer.
refuses() {
  if helm template tps "$chart" --values "$values" --kube-version "$oldest" "$@" > /dev/null 2>&1; then
    fail "The schema accepted $*."
  fi
}
refuses --set images.api.repository=localhost:5001/tps/api:latest
refuses --set images.api.digest=
refuses --set secrets.authSecret=
refuses --set database.ca.configMap=
refuses --set smtp.tls=none
refuses --set 'api.trustProxy[0]=0.0.0.0/0'
refuses --set api.extraEnv.HTTPS_PROXY=http://proxy.example.org
refuses --set-json 'database.networkPolicy={"cidr":"10.0.0.0/8","port":5432}'
refuses --set-json 'database.networkPolicy={"cidr":"169.254.169.254/32","port":5432}'
helm template tps "$chart" --values "$values" --kube-version "$oldest" > /dev/null \
  --set-json 'database.networkPolicy={"cidr":"10.1.2.3/32","port":5432}' \
  || fail 'The schema refused one private address for the database.'

echo '--- Start kind with a local registry'
kind create cluster --name "$cluster" --config infra/helm/ci/kind.yaml --wait 120s
docker run --detach --name "$registry" --publish 127.0.0.1:5001:5000 "$REGISTRY_IMAGE" > /dev/null
docker network connect kind "$registry"
for node in $(kind get nodes --name "$cluster"); do
  docker exec "$node" mkdir -p /etc/containerd/certs.d/localhost:5001
  printf '[host."http://%s:5000"]\n' "$registry" \
    | docker exec --interactive "$node" cp /dev/stdin /etc/containerd/certs.d/localhost:5001/hosts.toml
done

echo '--- Build the images as the stack does, and push them'
node scripts/stack.ts build api console portal proxy
project=$(node scripts/dev-names.ts | jq --exit-status --raw-output .stackProject)
digests=()
for service in api console portal proxy; do
  image=$service
  [ "$service" = proxy ] && image=edge
  repository="localhost:5001/tps/$image"
  docker tag "$project-$service:latest" "$repository:ci"
  docker push --quiet "$repository:ci" > /dev/null
  digest=$(docker inspect --format '{{json .RepoDigests}}' "$repository:ci" \
    | jq --exit-status --raw-output --arg repo "$repository@" \
      '.[] | select(startswith($repo)) | ltrimstr($repo)')
  digests+=(--set "images.$image.digest=$digest")
done

echo '--- Start the fixture services'
for name in "$namespace" "$fixtures"; do
  kubectl create namespace "$name"
  kubectl label namespace "$name" pod-security.kubernetes.io/enforce=restricted \
    pod-security.kubernetes.io/enforce-version=latest
done
for name in "${secret_names[@]}"; do
  kubectl create secret generic "tps-$name" --namespace "$namespace" \
    --from-file=value="$work/secrets/$name" > /dev/null
done
kubectl create secret generic tps-database-admin-password --namespace "$fixtures" \
  --from-file=value="$work/secrets/database-admin-password" > /dev/null
kubectl create secret tls tps-edge-tls --namespace "$namespace" \
  --cert "$work/edge.crt" --key "$work/edge.key" > /dev/null
for name in postgres mailpit; do
  kubectl create secret tls "tps-ci-$name-tls" --namespace "$fixtures" \
    --cert "$work/$name.crt" --key "$work/$name.key" > /dev/null
done
kubectl create configmap tps-ci-ca --namespace "$namespace" --from-file=ca.crt="$work/ca.crt"

# SeaweedFS's identities, as scripts/stack.ts makes them.
jq --null-input \
  --rawfile admin "$work/secrets/storage-admin-secret-key" \
  --rawfile write "$work/secrets/storage-write-secret-key" \
  --rawfile read "$work/secrets/storage-read-secret-key" \
  --rawfile scanner "$work/secrets/storage-scanner-secret-key" \
  --rawfile removal "$work/secrets/storage-removal-secret-key" '
  def identity($name; $key; $actions): {name: $name, credentials: [{accessKey: $name, secretKey: $key}], actions: $actions};
  {identities: [
    identity("tps-admin"; $admin; ["Admin:tps-files"]),
    identity("tps-write"; $write; ["Write:tps-files/clean/*"]),
    identity("tps-read"; $read; ["Read:tps-files/clean/*"]),
    identity("tps-scanner"; $scanner; ["Read:tps-files/clean/*", "Read:tps-files/withheld/*", "Write:tps-files/withheld/*"]),
    identity("tps-removal"; $removal; ["List:tps-files/clean/*", "Delete:tps-files/clean/*", "List:tps-files/withheld/*", "Delete:tps-files/withheld/*"])
  ]}' > "$work/storage-identities"
kubectl create secret generic tps-ci-storage-identities --namespace "$fixtures" \
  --from-file=value="$work/storage-identities" > /dev/null

kubectl apply --namespace "$fixtures" --filename infra/helm/ci/fixtures.yaml
kubectl wait --namespace "$fixtures" --for=condition=Available deployment --all --timeout 10m

# The bucket, as compose.stack.yaml's bucket job makes it: the admin key goes
# to curl on its standard input.
status=$(printf 'user = "tps-admin:%s"\n' "$(cat "$work/secrets/storage-admin-secret-key")" \
  | kubectl exec --stdin --namespace "$fixtures" deploy/seaweedfs -- \
    curl --config - --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --aws-sigv4 'aws:amz:us-east-1:s3' \
    --header 'x-amz-content-sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' \
    --upload-file /dev/null http://127.0.0.1:8333/tps-files)
[ "$status" = 200 ] || fail "Storage answered $status to the bucket request."

# The API server checks more than kubeconform and Trivy do (an except list
# outside its cidr, for one), so it sees every manifest before the migrate
# job touches the database.
echo '--- Check the API server accepts the rendered chart'
kubectl apply --dry-run=server --namespace "$namespace" --filename "$work/rendered.yaml" > /dev/null

echo '--- Install'
helm install tps "$chart" --namespace "$namespace" --values "$values" "${digests[@]}" \
  --wait --timeout 10m
[ "$(kubectl get job migrate --namespace "$namespace" --output jsonpath='{.status.succeeded}')" = 1 ] \
  || fail 'The migrate job did not succeed.'

echo '--- Check each pod mounts its own secrets alone'
expected='{
  "api": ["app_api_password", "app_auth_password", "auth_secret", "request_limit_key",
    "storage_read_secret_key", "storage_scanner_secret_key", "storage_write_secret_key", "subject_kek"],
  "worker": ["app_queue_password", "app_worker_password", "storage_read_secret_key",
    "storage_removal_secret_key", "storage_scanner_secret_key", "storage_write_secret_key", "subject_kek"],
  "migrate": ["app_api_password", "app_auth_password", "app_queue_password", "app_worker_password",
    "backup_reader_password", "database_admin_password", "migrator_password"],
  "edge": ["proxy_certificate", "proxy_key"],
  "console": [],
  "portal": []
}'
workloads=$(kubectl get deployments,jobs --namespace "$namespace" --output json)
mounted=$(jq --compact-output --sort-keys '[.items[] | {
    key: .metadata.labels["app.kubernetes.io/component"],
    value: ([.spec.template.spec.volumes[]? | .projected.sources[]?.secret // empty | .items[].path] | sort)
  }] | from_entries' <<< "$workloads")
[ "$mounted" = "$(jq --compact-output --sort-keys 'map_values(sort)' <<< "$expected")" ] \
  || fail "The pods mount other secrets than expected: $mounted"
jq --exit-status '[.items[].spec.template.spec | (.volumes[]? | select(.secret)),
    (.containers[] | (.env[]? | select(.valueFrom.secretKeyRef)), .envFrom[]?)] | length == 0' \
  <<< "$workloads" > /dev/null || fail 'A pod takes a secret other than through its projected volume.'

for workload in api worker edge; do
  echo "/run/secrets in $workload:"
  kubectl exec --namespace "$namespace" "deploy/$workload" -- ls -lnL /run/secrets
  kubectl exec --namespace "$namespace" "deploy/$workload" -- sh -c \
    'for file in /run/secrets/*; do [ "$(stat -L -c %a:%u:%g "$file")" = 440:0:1000 ] && head -c 1 "$file" > /dev/null || exit 1; done' \
    || fail "$workload's secret files are not 0440, root's and group 1000's, and readable."
done

echo '--- Check the edge'
kubectl port-forward --namespace "$namespace" service/edge 8443:443 > /dev/null &
forward=$!
edge() {
  curl --silent --show-error --cacert "$work/ca.crt" --max-time 10 \
    --resolve "$1:8443:127.0.0.1" "${@:3}" "https://$1:8443$2"
}
for _ in $(seq 30); do edge console.tps.test / --output /dev/null 2> /dev/null && break; sleep 1; done
edge console.tps.test / --fail --output /dev/null
edge portal.tps.test / --fail --output /dev/null
headers=$(edge portal.tps.test /api/ --dump-header - --output /dev/null)
grep --quiet --ignore-case '^x-request-id:' <<< "$headers" || fail 'The edge does not reach the API.'
grep --quiet --ignore-case '^strict-transport-security: max-age=63072000; includeSubDomains' <<< "$headers" \
  || fail 'The edge sends no HSTS header.'
kill "$forward"

echo '--- Check the network policies'
# kindnet does not police a pod's traffic to its own node, and the API
# server listens on the control-plane node, so the pods must run elsewhere.
control=" $(kubectl get nodes --selector node-role.kubernetes.io/control-plane \
  --output jsonpath='{.items[*].metadata.name}') "
for node in $(kubectl get pods --namespace "$namespace" --output jsonpath='{.items[*].spec.nodeName}'); do
  [[ "$control" != *" $node "* ]] || fail "A chart pod runs on the control-plane node $node."
done
connect='const [host, port] = process.argv.slice(1);
const socket = require("node:net").connect({ host, port: Number(port), timeout: 3000 });
socket.on("connect", () => process.exit(0));
socket.on("timeout", () => process.exit(3));
socket.on("error", () => process.exit(3));'
# 0 when the connection opens, 3 when it is refused or times out, and
# anything else when the probe itself could not run.
reaches() {
  kubectl exec --namespace "$namespace" "deploy/$1" -- node --eval "$connect" "$2" "$3"
}
open() {
  reaches "$@" || fail "$1 cannot reach $2:$3, which it needs."
  echo "$1 -> $2:$3 open"
}
closed() {
  status=0
  reaches "$@" || status=$?
  [ "$status" != 0 ] || fail "$1 reached $2:$3, which its network policy denies."
  [ "$status" = 3 ] || fail "The probe from $1 to $2:$3 did not run (exit $status)."
  echo "$1 -> $2:$3 closed"
}
fixture() {
  echo "$1.$fixtures.svc.cluster.local"
}

# Mailpit's inbox answers the node, so a refusal from the API is the policy's.
inbox=$(kubectl get pod --namespace "$fixtures" --selector app=mailpit --output jsonpath='{.items[0].status.podIP}')
docker exec "$cluster-control-plane" curl --silent --max-time 5 --output /dev/null "http://$inbox:8025/" \
  || fail "Mailpit's inbox does not answer, so a denial would prove nothing."
closed api "$(fixture mailpit)" 8025

console=$(kubectl get pod --namespace "$namespace" --selector app.kubernetes.io/component=console \
  --output jsonpath='{.items[0].status.podIP}')
for workload in api worker; do
  open "$workload" "$(fixture postgres)" 5432
  open "$workload" "$(fixture seaweedfs)" 8333
  open "$workload" "$(fixture mailpit)" 1025
  open "$workload" "$(fixture clamav)" 3310
  closed "$workload" 169.254.169.254 80
  closed "$workload" 169.254.169.254 443
  closed "$workload" "$inbox" 8025
  closed "$workload" "$console" 8080
  closed "$workload" "console.$namespace.svc.cluster.local" 8080
  closed "$workload" kubernetes.default.svc.cluster.local 443
  closed "$workload" "$(kubectl get service kubernetes --namespace default --output jsonpath='{.spec.clusterIP}')" 443
done

echo '--- Upgrade with the chart unchanged'
before=$(kubectl get job migrate --namespace "$namespace" --output jsonpath='{.metadata.uid}')
helm upgrade tps "$chart" --namespace "$namespace" --values "$values" "${digests[@]}" \
  --wait --timeout 10m
after=$(kubectl get job migrate --namespace "$namespace" --output jsonpath='{.metadata.uid}')
echo "migrate job before the upgrade: $before, after: $after"
[ "$before" != "$after" ] || fail 'The upgrade did not run the migrate job again.'
[ "$(kubectl get job migrate --namespace "$namespace" --output jsonpath='{.status.succeeded}')" = 1 ] \
  || fail 'The migrate job did not succeed on upgrade.'
kubectl wait --namespace "$namespace" --for=condition=Available deployment --all --timeout 5m

echo 'The chart installed, upgraded and passed every check.'
