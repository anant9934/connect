#!/bin/bash
# Exercises provision_render_worker.sh against a fake curl. It never reaches Render.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/provision_render_worker.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
mkdir "${WORK}/bin"
cat > "${WORK}/bin/curl" <<'FAKE'
#!/bin/bash
url="${@: -1}"
echo "${url}" >> "${FAKE_LOG}/calls"
for arg in "$@"; do [ "${arg}" = "@-" ] && cat >> "${FAKE_LOG}/bodies"; done
case "${url}" in
  *services\?name=*) echo '[]' ;;
  */env-vars\?limit=100) echo '[{"envVar":{"key":"DATABASE_URL","value":"postgres://api_secret_role:api_secret@h/d"}},{"envVar":{"key":"R2_ENDPOINT","value":"e"}},{"envVar":{"key":"R2_BUCKET","value":"b"}},{"envVar":{"key":"R2_ACCESS_KEY_ID","value":"k"}},{"envVar":{"key":"R2_SECRET_ACCESS_KEY","value":"s3cret"}}]' ;;
  */deploys) echo '{"id":"dep-1"}' ;;
  *) echo '{"id":"srv-new"}' ;;
esac
FAKE
chmod +x "${WORK}/bin/curl"
export FAKE_LOG="${WORK}"
export PATH="${WORK}/bin:${PATH}"
export RENDER_API_KEY="fake"
GOOD="postgres://connect_worker:worker_secret@h/d"

fail=0
check() {
  if [ "$1" != "$2" ]; then echo "FAIL: $3"; fail=1; else echo "PASS: $3"; fi
}
refuses() {
  local name="$1"; shift
  rm -f "${WORK}/calls"
  output=$(env "$@" bash "${SCRIPT}" 2>&1)
  status=$?
  [ "${status}" -ne 0 ]; check $? 0 "${name}: refused"
  [ ! -f "${WORK}/calls" ]; check $? 0 "${name}: made no Render call"
  case "${output}" in *secret*) check leaked clean "${name}: output hides the value" ;; *) check clean clean "${name}: output hides the value" ;; esac
}

refuses "missing URL" WORKER_DATABASE_URL= CONFIRM_PAID_WORKER_PLAN=yes
refuses "API role" WORKER_DATABASE_URL=postgres://connect_app:api_secret@h/d CONFIRM_PAID_WORKER_PLAN=yes
refuses "owner role" WORKER_DATABASE_URL=postgres://neondb_owner:owner_secret@h/d CONFIRM_PAID_WORKER_PLAN=yes
refuses "paid plan not confirmed" WORKER_DATABASE_URL="${GOOD}" CONFIRM_PAID_WORKER_PLAN=

rm -f "${WORK}/calls" "${WORK}/bodies"
output=$(env WORKER_DATABASE_URL="${GOOD}" CONFIRM_PAID_WORKER_PLAN=yes bash "${SCRIPT}" 2>&1)
check $? 0 "valid settings: completes"
grep -qF "${GOOD}" "${WORK}/bodies"; check $? 0 "worker URL is sent"
grep -qF 'api_secret' "${WORK}/bodies"; check $? 1 "API credential is not copied"
grep -qE '"key": *"DATABASE_URL"' "${WORK}/bodies"; check $? 1 "DATABASE_URL is not set on the worker"
case "${output}" in *secret*) check leaked clean "output hides secrets" ;; *) check clean clean "output hides secrets" ;; esac

exit "${fail}"
