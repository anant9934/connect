#!/bin/bash
# Creates the optional standalone Render worker. Production normally runs the in-process worker.
# The worker's database credential comes from the operator and is never copied from the API.
# Do not run this without owner approval: the Render worker plan is paid.
set -euo pipefail

RENDER_API_KEY="${RENDER_API_KEY:-${RENDER_API_TOKEN:-}}"
if [ -z "${RENDER_API_KEY}" ]; then
  echo "ERROR: RENDER_API_KEY or RENDER_API_TOKEN environment variable is required."
  exit 1
fi
if [ -z "${WORKER_DATABASE_URL:-}" ]; then
  echo "ERROR: WORKER_DATABASE_URL is required. It must log in as connect_worker."
  exit 1
fi
case "${WORKER_DATABASE_URL}" in
  postgres://connect_worker:*|postgresql://connect_worker:*) ;;
  *)
    echo "ERROR: WORKER_DATABASE_URL does not log in as connect_worker. The value is not shown."
    exit 1
    ;;
esac
if [ "${CONFIRM_PAID_WORKER_PLAN:-}" != "yes" ]; then
  echo "ERROR: this creates a paid Render service. Set CONFIRM_PAID_WORKER_PLAN=yes only with owner approval."
  exit 1
fi

EXISTING_SERVICE_ID="srv-dbj507nlk1mc73897go0"
OWNER_ID="tea-dbib05ss728c73cra4pg"
REPO="https://github.com/anant9934/connect"
BRANCH="main"
ROOT_DIR="connect-main/services/api"
SERVICE_NAME="tathastu-connect-worker"
PLAN="starter"
REGION="ohio"

echo "======================================================"
echo "    CONNECT — RENDER BACKGROUND WORKER PROVISIONER    "
echo "======================================================"

echo "==> 1. Checking existing services on Render..."
EXISTING_WORKER=$(curl -s -H "Authorization: Bearer ${RENDER_API_KEY}" "https://api.render.com/v1/services?name=${SERVICE_NAME}" | jq -r '.[0].service.id // empty')

if [ -n "${EXISTING_WORKER}" ]; then
  echo "==> Worker service '${SERVICE_NAME}' already exists (ID: ${EXISTING_WORKER})."
  WORKER_ID="${EXISTING_WORKER}"
else
  echo "==> 2. Reading object storage settings from the API service (${EXISTING_SERVICE_ID})..."
  API_ENV_JSON=$(curl -s -H "Authorization: Bearer ${RENDER_API_KEY}" "https://api.render.com/v1/services/${EXISTING_SERVICE_ID}/env-vars?limit=100")
  api_env() { echo "${API_ENV_JSON}" | jq -r --arg key "$1" '.[] | select(.envVar.key==$key) | .envVar.value'; }
  R2_ENDPOINT=$(api_env R2_ENDPOINT)
  R2_BUCKET=$(api_env R2_BUCKET)
  R2_ACCESS_KEY_ID=$(api_env R2_ACCESS_KEY_ID)
  R2_SECRET_ACCESS_KEY=$(api_env R2_SECRET_ACCESS_KEY)
  echo "==> Read object storage configuration (values protected)."

  echo "==> 3. Creating background worker service on Render..."
  CREATE_PAYLOAD=$(jq -n --arg owner "${OWNER_ID}" --arg name "${SERVICE_NAME}" --arg repo "${REPO}" --arg branch "${BRANCH}" \
    --arg root "${ROOT_DIR}" --arg plan "${PLAN}" --arg region "${REGION}" '{
      ownerId: $owner, type: "background_worker", name: $name, repo: $repo, branch: $branch, rootDir: $root, autoDeploy: "yes",
      serviceDetails: { env: "docker", plan: $plan, region: $region,
        envSpecificDetails: { dockerCommand: "/app/worker", dockerContext: ".", dockerfilePath: "./Dockerfile" } }
    }')

  CREATE_RESP=$(printf '%s' "${CREATE_PAYLOAD}" | curl -s -X POST \
    -H "Authorization: Bearer ${RENDER_API_KEY}" \
    -H "Content-Type: application/json" \
    --data @- \
    "https://api.render.com/v1/services")

  WORKER_ID=$(echo "${CREATE_RESP}" | jq -r '.id // empty')

  if [ -z "${WORKER_ID}" ]; then
    ERR_MSG=$(echo "${CREATE_RESP}" | jq -r '.message // "Unknown error"')
    echo "FAILED to create service: ${ERR_MSG}"
    exit 2
  fi

  echo "==> Service created successfully! Service ID: ${WORKER_ID}"

  echo "==> 4. Setting worker environment variables..."
  # Sent on stdin so secrets never appear in a process listing. DATABASE_URL is deliberately absent.
  jq -n --arg db "${WORKER_DATABASE_URL}" --arg endpoint "${R2_ENDPOINT}" --arg bucket "${R2_BUCKET}" \
    --arg key "${R2_ACCESS_KEY_ID}" --arg secret "${R2_SECRET_ACCESS_KEY}" '[
      {key: "APP_ENV", value: "production"},
      {key: "WORKER_DATABASE_URL", value: $db},
      {key: "LOG_LEVEL", value: "info"},
      {key: "WORKER_CONCURRENCY", value: "5"},
      {key: "WORKER_BATCH_SIZE", value: "10"},
      {key: "WORKER_POLL_INTERVAL", value: "1s"},
      {key: "WORKER_LEASE_TTL", value: "30s"},
      {key: "STORAGE_PROVIDER", value: "r2"},
      {key: "R2_ENDPOINT", value: $endpoint},
      {key: "R2_BUCKET", value: $bucket},
      {key: "R2_ACCESS_KEY_ID", value: $key},
      {key: "R2_SECRET_ACCESS_KEY", value: $secret},
      {key: "R2_REGION", value: "auto"}
    ]' | curl -s -X PUT \
    -H "Authorization: Bearer ${RENDER_API_KEY}" \
    -H "Content-Type: application/json" \
    --data @- \
    "https://api.render.com/v1/services/${WORKER_ID}/env-vars" > /dev/null

  echo "==> Environment variables applied securely."
fi

echo "==> 5. Triggering deployment..."
DEPLOY_RESP=$(curl -s -X POST \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"clearCache": "do_not_clear"}' \
  "https://api.render.com/v1/services/${WORKER_ID}/deploys")

DEPLOY_ID=$(echo "${DEPLOY_RESP}" | jq -r '.id // empty')
echo "==> Deploy triggered: ${DEPLOY_ID}"
echo "==> Service URL: https://dashboard.render.com/worker/${WORKER_ID}"
