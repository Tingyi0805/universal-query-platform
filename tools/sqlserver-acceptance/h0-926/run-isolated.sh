#!/usr/bin/env bash
set -euo pipefail
# NEW VM ONLY. Never invoke on the existing UQP workstation/server.
[[ "${UQP926_APPROVE:-}" == "CREATE_DISPOSABLE_SYNTHETIC_926_ONLY" ]] || {
  echo 'SQL_ACCEPTANCE=NOT_RUN; explicit disposable-instance approval required' >&2; exit 2;
}
[[ "${UQP926_VM_APPROVE:-}" == "NEW_UBUNTU_2404_VM_ONLY" ]] || {
  echo 'SQL_ACCEPTANCE=NOT_RUN; administrator must confirm a new dedicated VM' >&2; exit 2;
}
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
command -v node >/dev/null
command -v git >/dev/null
command -v docker >/dev/null
task_tmp="$(mktemp -d)"
export UQP926_RUN_ID="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
export UQP926_PASSWORD="S9!$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')z"
export UQP926_COMMIT="$(git -C "$task_root" rev-parse HEAD)"
# Ignore stale metadata inherited from a previous invocation.
unset UQP926_CONTAINER_ID UQP926_NETWORK_ID UQP926_IMAGE_ID UQP926_IMAGE_DIGEST
task_docker() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"
}
task_report() {
  (cd "$task_root/server" && node --import tsx src/scripts/workstation926AcceptanceReport.ts "$1")
}
task_network=""
task_container_cleanup="NOT_CREATED"
task_network_cleanup="NOT_CREATED"
cleanup() {
  task_exit=$?
  trap - EXIT INT TERM
  # A matching ID alone is insufficient: verify the invocation label as well.
  if [[ -f "$task_tmp/cid" ]]; then
    task_id="$(cat "$task_tmp/cid")"
    if [[ "$task_id" =~ ^[0-9a-f]{64}$ ]]; then
      export UQP926_CONTAINER_ID="$task_id"
      if task_label="$(task_docker inspect --format '{{index .Config.Labels "uqp926.run"}}' "$task_id" 2>/dev/null)"; then
        if [[ "$task_label" != "$UQP926_RUN_ID" ]]; then
          task_container_cleanup="REFUSED"
        elif task_docker rm -f "$task_id" >/dev/null; then task_container_cleanup="REMOVED"
        else task_container_cleanup="FAILED"; fi
      elif task_docker info >/dev/null 2>&1; then
        task_container_cleanup="NOT_CREATED" # --rm may already have removed it.
      else task_container_cleanup="UNKNOWN"; fi
    else task_container_cleanup="REFUSED"; fi
  fi
  if [[ -n "$task_network" ]]; then
    if [[ ! "$task_network" =~ ^[0-9a-f]{64}$ ]]; then task_network_cleanup="REFUSED"
    elif task_label="$(task_docker network inspect --format '{{index .Labels "uqp926.run"}}' "$task_network" 2>/dev/null)"; then
      if [[ "$task_label" != "$UQP926_RUN_ID" ]]; then task_network_cleanup="REFUSED"
      elif [[ "$(task_docker network inspect --format '{{len .Containers}}' "$task_network" 2>/dev/null)" != "0" ]]; then
        task_network_cleanup="REFUSED" # Never disconnect somebody else's container.
      elif task_docker network rm "$task_network" >/dev/null; then task_network_cleanup="REMOVED"
      else task_network_cleanup="FAILED"; fi
    else task_network_cleanup="UNKNOWN"; fi
  fi
  for task_status in "$task_container_cleanup" "$task_network_cleanup"; do
    if [[ "$task_status" == "REFUSED" || "$task_status" == "FAILED" || "$task_status" == "UNKNOWN" ]]; then
      if [[ "$task_exit" == "0" ]]; then task_exit=1; fi
    fi
  done
  export UQP926_CONTAINER_CLEANUP="$task_container_cleanup" UQP926_NETWORK_CLEANUP="$task_network_cleanup" UQP926_EXIT_CODE="$task_exit"
  task_report cleanup || task_exit=1
  rm -rf -- "$task_tmp"
  unset UQP926_PASSWORD
  exit "$task_exit"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
task_report init # Fresh 21-case NOT_RUN report before touching the new VM daemon.
task_docker info >/dev/null
task_network="$(task_docker network create --internal --label "uqp926.run=$UQP926_RUN_ID" "uqp926-$UQP926_RUN_ID")"
[[ "$task_network" =~ ^[0-9a-f]{64}$ ]]
export UQP926_NETWORK_ID="$task_network"
[[ "$(task_docker network inspect --format '{{index .Labels "uqp926.run"}}' "$task_network")" == "$UQP926_RUN_ID" ]]
[[ "$(task_docker network inspect --format '{{.Internal}}' "$task_network")" == "true" ]]
[[ "$(task_docker network inspect --format '{{len .Containers}}' "$task_network")" == "0" ]]
# No bind mounts, host network, production config, external DB or persistent volumes.
# Docker port collision fails; it never replaces an existing service.
MSSQL_SA_PASSWORD="$UQP926_PASSWORD" task_docker run -d --rm --cidfile "$task_tmp/cid" --name "uqp926-$UQP926_RUN_ID" --hostname uqp-h0-926-isolated --label "uqp926.run=$UQP926_RUN_ID" --network "$task_network" --memory 4g -p 127.0.0.1:14336:1433 -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD mcr.microsoft.com/mssql/server:2019-latest >/dev/null
export UQP926_CONTAINER_ID="$(cat "$task_tmp/cid")"
[[ "$UQP926_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]
[[ "$(task_docker inspect --format '{{index .Config.Labels "uqp926.run"}}' "$UQP926_CONTAINER_ID")" == "$UQP926_RUN_ID" ]]
export UQP926_IMAGE_ID="$(task_docker inspect --format '{{.Image}}' "$UQP926_CONTAINER_ID")"
[[ "$UQP926_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
export UQP926_IMAGE_DIGEST="$(task_docker image inspect --format '{{index .RepoDigests 0}}' "$UQP926_IMAGE_ID" 2>/dev/null || true)"
echo "UQP926_RUN_ID=$UQP926_RUN_ID"
cd "$task_root/server"
node --import tsx src/scripts/workstation926SqlAcceptance.ts
