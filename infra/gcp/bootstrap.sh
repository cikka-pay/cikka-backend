#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Cikka — GCP bootstrap (cheapest-possible production footprint)
#
# Idempotent: safe to re-run. Creates (if missing):
#   • Artifact Registry repo           (Docker images)
#   • Runtime service account          (Cloud Run → Cloud SQL, Secret Manager, GCS)
#   • VPC + subnet + private service access (org policy forbids Cloud SQL public IPs)
#   • Cloud SQL Postgres 18, db-f1-micro, zonal, private IP only
#   • Database + user, DATABASE_URL in Secret Manager
#   • GCS bucket for uploads, accessed keylessly as the runtime SA
#     (STORAGE_PROVIDER=gcs; org policy forbids SA keys, so no HMAC)
#   • GitHub Actions deployer SA via Workload Identity Federation (no JSON keys)
#
# Region asia-south1 (Mumbai) → outbound traffic leaves from Indian IPs, which
# Setu requires. No Cloud NAT / static IP yet (InstantPay allowlist deferred).
#
# Usage:  bash infra/gcp/bootstrap.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-cikka-application}"
REGION="${REGION:-asia-south1}"
AR_REPO="cikka"
RUNTIME_SA="cikka-backend"
DEPLOY_SA="github-deployer"
BUILD_SA="cloud-builder"
SQL_INSTANCE="cikka-pg"
SQL_TIER="db-f1-micro"
DB_NAME="cikka_prod"
DB_USER="cikka"
BUCKET="${BUCKET:-cikka-uploads-${PROJECT_ID}}"
GITHUB_REPO="${GITHUB_REPO:-cikka-pay/cikka-backend}"
WIF_POOL="github"
WIF_PROVIDER="github-actions"
VPC_NAME="cikka-vpc"
SUBNET_NAME="cikka-run-${REGION}"

gc() { gcloud --project "$PROJECT_ID" --quiet "$@"; }
log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA_EMAIL="${DEPLOY_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA_EMAIL="${BUILD_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

put_secret() { # name value — creates the secret if needed, adds a version only if the value changed
  local name="$1" value="$2"
  if ! gc secrets describe "$name" >/dev/null 2>&1; then
    gc secrets create "$name" --replication-policy=user-managed --locations="$REGION" >/dev/null
  fi
  local current
  current="$(gc secrets versions access latest --secret="$name" 2>/dev/null || true)"
  if [[ "$current" != "$value" ]]; then
    printf '%s' "$value" | gc secrets versions add "$name" --data-file=- >/dev/null
    echo "  secret $name: new version"
  else
    echo "  secret $name: unchanged"
  fi
}

# ── APIs ─────────────────────────────────────────────────────────────────────
log "Enabling APIs"
gc services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com storage.googleapis.com \
  compute.googleapis.com servicenetworking.googleapis.com

# ── Artifact Registry ────────────────────────────────────────────────────────
log "Artifact Registry: $AR_REPO"
gc artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1 ||
  gc artifacts repositories create "$AR_REPO" --repository-format=docker --location="$REGION" \
    --description="Cikka container images"
# Keep storage cost ~0: delete untagged images older than 7 days, keep the latest 10.
POLICY_FILE="$(mktemp)"
cat >"$POLICY_FILE" <<'JSON'
[
  {"name":"keep-recent","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":10}},
  {"name":"delete-old","action":{"type":"Delete"},"condition":{"olderThan":"604800s"}}
]
JSON
gc artifacts repositories set-cleanup-policies "$AR_REPO" --location="$REGION" \
  --policy="$POLICY_FILE" --no-dry-run >/dev/null

# ── Service accounts ─────────────────────────────────────────────────────────
log "Service accounts"
for sa in "$RUNTIME_SA:Cikka backend runtime" "$DEPLOY_SA:GitHub Actions deployer" "$BUILD_SA:Cloud Build (manual builds)" "cikka-fe:Cikka frontend runtime (no roles)"; do
  id="${sa%%:*}"; name="${sa#*:}"
  gc iam service-accounts describe "${id}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 ||
    gc iam service-accounts create "$id" --display-name="$name"
done

for role in roles/cloudsql.client roles/secretmanager.secretAccessor; do
  gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA_EMAIL" \
    --role="$role" --condition=None >/dev/null
done
for role in roles/run.admin roles/artifactregistry.writer; do
  gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA_EMAIL" \
    --role="$role" --condition=None >/dev/null
done
# Cloud Build runs as its own SA (the default compute SA has no grants here).
for role in roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectUser; do
  gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$BUILD_SA_EMAIL" \
    --role="$role" --condition=None >/dev/null
done

# Deployer may deploy Cloud Run revisions that run as the backend / frontend SAs.
for sa in "$RUNTIME_SA_EMAIL" "cikka-fe@${PROJECT_ID}.iam.gserviceaccount.com"; do
  gc iam service-accounts add-iam-policy-binding "$sa" \
    --member="serviceAccount:$DEPLOY_SA_EMAIL" --role=roles/iam.serviceAccountUser >/dev/null
done

# ── VPC + private service access (org policy forbids public IPs on Cloud SQL) ─
# Cloud Run reaches Cloud SQL's private IP via Direct VPC egress on this subnet
# (no Serverless VPC connector to pay for). Internet traffic does NOT go through
# the VPC (--vpc-egress=private-ranges-only), so no Cloud NAT is needed.
log "VPC: $VPC_NAME / $SUBNET_NAME + private service access"
gc compute networks describe "$VPC_NAME" >/dev/null 2>&1 ||
  gc compute networks create "$VPC_NAME" --subnet-mode=custom
gc compute networks subnets describe "$SUBNET_NAME" --region="$REGION" >/dev/null 2>&1 ||
  gc compute networks subnets create "$SUBNET_NAME" --network="$VPC_NAME" --region="$REGION" \
    --range=10.10.0.0/24 --enable-private-ip-google-access
gc compute addresses describe google-managed-services --global >/dev/null 2>&1 ||
  gc compute addresses create google-managed-services --global --purpose=VPC_PEERING \
    --prefix-length=20 --network="$VPC_NAME"
gc services vpc-peerings list --network="$VPC_NAME" --format='value(peering)' | grep -q . ||
  gc services vpc-peerings connect --service=servicenetworking.googleapis.com \
    --ranges=google-managed-services --network="$VPC_NAME"

# ── Cloud SQL ────────────────────────────────────────────────────────────────
log "Cloud SQL: $SQL_INSTANCE ($SQL_TIER, POSTGRES_18, private IP) — first create takes ~10 min"
if ! gc sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  gc sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_18 --edition=ENTERPRISE --tier="$SQL_TIER" \
    --region="$REGION" --availability-type=ZONAL \
    --network="projects/${PROJECT_ID}/global/networks/${VPC_NAME}" --no-assign-ip \
    --storage-type=SSD --storage-size=10 --storage-auto-increase \
    --backup-start-time=21:00 --retained-backups-count=7 \
    --maintenance-window-day=SUN --maintenance-window-hour=21 \
    --deletion-protection
fi
gc sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1 ||
  gc sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"

if ! gc secrets describe DATABASE_URL >/dev/null 2>&1; then
  DB_PASS="$(openssl rand -hex 24)"
  if gc sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
    gc sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASS"
  else
    gc sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASS"
  fi
  SQL_IP="$(gc sql instances describe "$SQL_INSTANCE" --format='value(ipAddresses[0].ipAddress)')"
  put_secret DATABASE_URL "postgresql://${DB_USER}:${DB_PASS}@${SQL_IP}:5432/${DB_NAME}"
else
  echo "  DATABASE_URL secret exists — leaving DB password as is"
fi

# ── GCS bucket (uploads) + HMAC key for the S3 client ────────────────────────
log "GCS bucket: gs://$BUCKET"
gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT_ID" --location="$REGION" \
    --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$RUNTIME_SA_EMAIL" --role=roles/storage.objectAdmin >/dev/null
# Keyless signed URLs: the app signs via IAM signBlob as its own SA
# (org policy iam.disableServiceAccountKeyCreation rules out HMAC / JSON keys).
gc iam service-accounts add-iam-policy-binding "$RUNTIME_SA_EMAIL" \
  --member="serviceAccount:$RUNTIME_SA_EMAIL" --role=roles/iam.serviceAccountTokenCreator >/dev/null

# ── Workload Identity Federation (GitHub Actions → deployer SA) ─────────────
log "Workload Identity Federation for $GITHUB_REPO"
gc iam workload-identity-pools describe "$WIF_POOL" --location=global >/dev/null 2>&1 ||
  gc iam workload-identity-pools create "$WIF_POOL" --location=global --display-name="GitHub"
gc iam workload-identity-pools providers describe "$WIF_PROVIDER" --location=global \
  --workload-identity-pool="$WIF_POOL" >/dev/null 2>&1 ||
  gc iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" --location=global \
    --workload-identity-pool="$WIF_POOL" --display-name="GitHub Actions" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository_owner == '${GITHUB_REPO%%/*}'"
for repo in "$GITHUB_REPO" "${GITHUB_REPO%%/*}/cikka-fe"; do
  gc iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" \
    --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${repo}" \
    >/dev/null
done

log "Done"
cat <<EOF
  Cloud SQL connection : ${PROJECT_ID}:${REGION}:${SQL_INSTANCE}
  Bucket               : gs://${BUCKET}
  Image repo           : ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}
  Runtime SA           : ${RUNTIME_SA_EMAIL}
  Deployer SA          : ${DEPLOY_SA_EMAIL}
  WIF provider         : projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}
EOF
