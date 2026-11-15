#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-off: copy cikka-backend's env vars from Railway into GCP.
#   • sensitive values  → Secret Manager (one secret per var)
#   • plain config      → $OUT_ENV_FILE (YAML for `gcloud run deploy --env-vars-file`)
#   • Railway-only vars → dropped (RAILWAY_*, bucket creds, DATABASE_URL, ...)
# Values are never printed. Needs `railway login` and gcloud auth.
#
# Usage: OUT_ENV_FILE=/path/env.yaml bash infra/gcp/sync-railway-env.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-cikka-application}"
REGION="${REGION:-asia-south1}"
RAILWAY_PROJECT="${RAILWAY_PROJECT:-1f099b5b-96a4-406a-9190-d024a526f50c}"
RAILWAY_SERVICE="${RAILWAY_SERVICE:-cikka-backend}"
OUT_ENV_FILE="${OUT_ENV_FILE:?set OUT_ENV_FILE}"
SECRETS_LIST_FILE="${SECRETS_LIST_FILE:-${OUT_ENV_FILE%.*}.secrets}"

# Railway-specific or replaced on GCP.
DROP_RE='^(RAILWAY_.*|ACCESS_KEY_ID|SECRET_ACCESS_KEY|BUCKET|ENDPOINT|REGION|DATABASE_URL|STORAGE_PROVIDER|PUBLIC_BASE_URL|PORT)$'
# Non-sensitive config → plain env vars (cheaper than one secret each).
PLAIN_RE='^(NODE_ENV|EXTERNAL_SERVICES_MODE|JWT_EXPIRES_IN|CORS_ORIGIN|HUBBLE_ENV|HUBBLE_MOCK_MODE|HUBBLE_SSO_MODE|.*_BASE_URL|SETU_CHECK_STATUS_URL|RESEND_FROM_EMAIL|MSG91_TEMPLATE_ID.*|INSTANTPAY_ENDPOINT_IP|BBPS_.*|REWARD_.*|JOBS_.*)$'

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
railway link -p "$RAILWAY_PROJECT" -e production -s "$RAILWAY_SERVICE" >/dev/null
railway variables --service "$RAILWAY_SERVICE" --environment production --json >"$TMP/vars.json"

: >"$OUT_ENV_FILE"; : >"$SECRETS_LIST_FILE"
n_secret=0; n_plain=0; n_drop=0
while IFS= read -r name; do
  if [[ "$name" =~ $DROP_RE ]]; then n_drop=$((n_drop + 1)); continue; fi
  if [[ "$name" =~ $PLAIN_RE ]]; then
    jq -r --arg k "$name" '{($k): .[$k]}' "$TMP/vars.json" | jq -r 'to_entries[] | "\(.key): \(.value | @json)"' >>"$OUT_ENV_FILE"
    n_plain=$((n_plain + 1)); continue
  fi
  if ! gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$name" --project "$PROJECT_ID" --replication-policy=user-managed \
      --locations="$REGION" --quiet >/dev/null
  fi
  current="$(gcloud secrets versions access latest --secret="$name" --project "$PROJECT_ID" 2>/dev/null || true)"
  value="$(jq -r --arg k "$name" '.[$k]' "$TMP/vars.json")"
  if [[ "$current" != "$value" ]]; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --project "$PROJECT_ID" --data-file=- --quiet >/dev/null
  fi
  echo "$name" >>"$SECRETS_LIST_FILE"
  n_secret=$((n_secret + 1))
done < <(jq -r 'keys[]' "$TMP/vars.json")

echo "secrets: $n_secret  plain: $n_plain  dropped: $n_drop"
echo "plain env → $OUT_ENV_FILE"
echo "secret names → $SECRETS_LIST_FILE"
