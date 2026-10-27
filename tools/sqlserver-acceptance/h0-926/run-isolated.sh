#!/usr/bin/env bash
set -euo pipefail
# This launcher ALWAYS creates its own empty container; never targets an existing instance.
[[ "${UQP926_APPROVE:-}" == "CREATE_DISPOSABLE_SYNTHETIC_926_ONLY" ]] || {
  echo 'SQL_ACCEPTANCE=NOT_RUN; explicit disposable-instance approval required' >&2; exit 2;
}
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
task_tmp="$(mktemp -d)"
export UQP926_RUN_ID="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
export UQP926_PASSWORD="S9!$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')z"
task_docker() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    docker --host=unix:///var/run/docker.sock "$@"
}
task_network=""
cleanup() {
  # Only resources created by this invocation, never user containers/databases.
  if [[ -f "$task_tmp/cid" ]]; then
    task_id="$(cat "$task_tmp/cid")"
    if [[ "$task_id" =~ ^[0-9a-f]{64}$ ]] &&
       [[ "$(task_docker inspect --format '{{index .Config.Labels "uqp926.run"}}' "$task_id" 2>/dev/null)" == "$UQP926_RUN_ID" ]]; then
      task_docker rm -f "$task_id" >/dev/null || true
    fi
  fi
  if [[ -n "$task_network" ]]; then task_docker network rm "$task_network" >/dev/null || true; fi
  rm -rf -- "$task_tmp"
  unset UQP926_PASSWORD
}
trap cleanup EXIT
task_docker info >/dev/null
task_network="$(task_docker network create --internal --label "uqp926.run=$UQP926_RUN_ID" "uqp926-$UQP926_RUN_ID")"
# No bind mounts, host network, production config, external DB or persistent volumes.
# Docker port collision fails; it never replaces an existing service.
MSSQL_SA_PASSWORD="$UQP926_PASSWORD" task_docker run -d --rm --cidfile "$task_tmp/cid" \
  --name "uqp926-$UQP926_RUN_ID" --hostname uqp-h0-926-isolated \
  --label "uqp926.run=$UQP926_RUN_ID" --network "$task_network" --memory 4g \
  -p 127.0.0.1:14336:1433 -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD \
  mcr.microsoft.com/mssql/server:2019-latest >/dev/null
cd "$task_root/server"
node --import tsx src/scripts/workstation926SqlAcceptance.ts
