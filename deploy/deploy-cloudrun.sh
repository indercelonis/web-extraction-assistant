#!/usr/bin/env bash
# Stage static assets, build/push via Cloud Run source deploy.
# Prerequisites: gcloud auth'd as @celonis.com, Docker or Cloud Build, billing enabled.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-}}"
REGION="${REGION:-europe-west3}"
SERVICE="${SERVICE:-web-extraction-assistant}"

if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "REPLACE_WITH_CELONIS_GCP_PROJECT_ID" ]]; then
  echo "Usage: $0 <celonis-gcp-project-id>"
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is not installed. Install Google Cloud SDK, then run: gcloud auth login"
  exit 1
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/wea-deploy.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "Staging into $STAGE"
mkdir -p "$STAGE/css" "$STAGE/js" "$STAGE/vendor" "$STAGE/fixtures"
cp "$ROOT/index.html" "$STAGE/"
cp "$ROOT/nginx.conf" "$STAGE/"
cp "$ROOT/Dockerfile" "$STAGE/"
cp -R "$ROOT/css/." "$STAGE/css/"
cp -R "$ROOT/js/." "$STAGE/js/"
cp -R "$ROOT/vendor/." "$STAGE/vendor/"
cp -R "$ROOT/fixtures/." "$STAGE/fixtures/"
rm -f "$STAGE/js/check-folder-node.js" "$STAGE/js/check-xpath-node.js"

# Empty ignore file so local node_modules never get uploaded from the stage dir.
: > "$STAGE/.gcloudignore"

echo "Project: $PROJECT_ID | Region: $REGION | Service: $SERVICE"
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com iap.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com

gcloud run deploy "$SERVICE" \
  --source "$STAGE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 256Mi \
  --cpu 1 \
  --max-instances 3

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "Deployed: $URL"
echo
echo "Celonis-only gate (required before sharing):"
echo "  1. Console → Security → Identity-Aware Proxy → enable for this Cloud Run service"
echo "  2. Grant 'IAP-secured Web App User' to domain:celonis.com (or a Google Group)"
echo "  3. Remove public allUsers Cloud Run Invoker"
echo
echo "Until IAP is on, treat the URL as public."
