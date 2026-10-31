#!/bin/bash
set -euo pipefail

RENDER_API_KEY="${RENDER_API_KEY:-${RENDER_API_TOKEN:-}}"
if [ -z "${RENDER_API_KEY}" ]; then
  echo "ERROR: RENDER_API_KEY or RENDER_API_TOKEN environment variable is required."
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
  echo "==> 2. Fetching environment configuration from API service (${EXISTING_SERVICE_ID})..."
  API_ENV_JSON=$(curl -s -H "Authorization: Bearer ${RENDER_API_KEY}" "https://api.render.com/v1/services/${EXISTING_SERVICE_ID}/env-vars?limit=50")

  DATABASE_URL=$(echo "${API_ENV_JSON}" | jq -r '.[] | select(.envVar.key=="DATABASE_URL") | .envVar.value')
  R2_ENDPOINT=$(echo "${API_ENV_JSON}" | jq -r '.[] | select(.envVar.key=="R2_ENDPOINT") | .envVar.value')
  R2_BUCKET=$(echo "${API_ENV_JSON}" | jq -r '.[] | select(.envVar.key=="R2_BUCKET") | .envVar.value')
  R2_ACCESS_KEY_ID=$(echo "${API_ENV_JSON}" | jq -r '.[] | select(.envVar.key=="R2_ACCESS_KEY_ID") | .envVar.value')
  R2_SECRET_ACCESS_KEY=$(echo "${API_ENV_JSON}" | jq -r '.[] | select(.envVar.key=="R2_SECRET_ACCESS_KEY") | .envVar.value')

  if [ -z "${DATABASE_URL}" ] || [ "${DATABASE_URL}" == "null" ]; then
    echo "ERROR: DATABASE_URL not found on API service."
    exit 1
  fi
  echo "==> Extracted required database and object storage configuration (values protected)."

  echo "==> 3. Creating background worker service on Render..."
  CREATE_PAYLOAD=$(cat <<EOF
{
  "ownerId": "${OWNER_ID}",
  "type": "background_worker",
  "name": "${SERVICE_NAME}",
  "repo": "${REPO}",
  "branch": "${BRANCH}",
  "rootDir": "${ROOT_DIR}",
  "autoDeploy": "yes",
  "serviceDetails": {
    "env": "docker",
    "plan": "${PLAN}",
    "region": "${REGION}",
    "envSpecificDetails": {
      "dockerCommand": "/app/worker",
      "dockerContext": ".",
      "dockerfilePath": "./Dockerfile"
    }
  }
}
EOF
)

  CREATE_RESP=$(curl -s -X POST \
    -H "Authorization: Bearer ${RENDER_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "${CREATE_PAYLOAD}" \
    "https://api.render.com/v1/services")

  WORKER_ID=$(echo "${CREATE_RESP}" | jq -r '.id // empty')

  if [ -z "${WORKER_ID}" ]; then
    ERR_MSG=$(echo "${CREATE_RESP}" | jq -r '.message // "Unknown error"')
    echo "FAILED to create service: ${ERR_MSG}"
    echo "${CREATE_RESP}" | jq .
    exit 2
  fi

  echo "==> Service created successfully! Service ID: ${WORKER_ID}"

  echo "==> 4. Setting worker environment variables..."
  ENV_VARS_PAYLOAD=$(cat <<EOF
[
  {"key": "APP_ENV", "value": "production"},
  {"key": "DATABASE_URL", "value": "${DATABASE_URL}"},
  {"key": "LOG_LEVEL", "value": "info"},
  {"key": "WORKER_CONCURRENCY", "value": "5"},
  {"key": "WORKER_BATCH_SIZE", "value": "10"},
  {"key": "WORKER_POLL_INTERVAL", "value": "1s"},
  {"key": "WORKER_LEASE_TTL", "value": "30s"},
  {"key": "STORAGE_PROVIDER", "value": "r2"},
  {"key": "R2_ENDPOINT", "value": "${R2_ENDPOINT}"},
  {"key": "R2_BUCKET", "value": "${R2_BUCKET}"},
  {"key": "R2_ACCESS_KEY_ID", "value": "${R2_ACCESS_KEY_ID}"},
  {"key": "R2_SECRET_ACCESS_KEY", "value": "${R2_SECRET_ACCESS_KEY}"},
  {"key": "R2_REGION", "value": "auto"}
]
EOF
)

  curl -s -X PUT \
    -H "Authorization: Bearer ${RENDER_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "${ENV_VARS_PAYLOAD}" \
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
