#!/usr/bin/env bash
# Deploy to Firebase Hosting (public CDN).
# Note: Firebase Hosting alone does NOT restrict to Celonis accounts.
# Prefer deploy/deploy-cloudrun.sh + IAP for company-only access.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ID="${1:-}"
export FIREBASE_CLI_LOG_FILE="${FIREBASE_CLI_LOG_FILE:-/tmp/firebase-debug.log}"
FB="$ROOT/node_modules/.bin/firebase"

if [[ ! -x "$FB" ]]; then
  echo "firebase-tools missing. From $ROOT run: npm install"
  exit 1
fi

if [[ -n "$PROJECT_ID" ]]; then
  node -e "
    const fs=require('fs');
    const p='$ROOT/.firebaserc';
    const j=JSON.parse(fs.readFileSync(p,'utf8'));
    j.projects=j.projects||{};
    j.projects.default=process.argv[1];
    fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
  " "$PROJECT_ID"
fi

if grep -q 'REPLACE_WITH_CELONIS_GCP_PROJECT_ID' "$ROOT/.firebaserc" 2>/dev/null; then
  echo "Set the project id in .firebaserc or pass it: $0 <gcp-project-id>"
  exit 1
fi

# firebase-debug.log is written in cwd; avoid OneDrive permission issues.
cd /tmp
"$FB" --config "$ROOT/firebase.json" deploy --only hosting --project "$(node -p "require('$ROOT/.firebaserc').projects.default")"
