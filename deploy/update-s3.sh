#!/usr/bin/env bash
# Update an S3 bucket and CloudFront distribution that already exist.
#
# deploy-s3.sh beside this file creates the whole stack through
# CloudFormation and owns what it creates. A bucket and distribution built by
# hand in the console are not part of any stack, and pointing that script at
# them would build a second copy of everything. This one only uploads.
#
# Usage:
#   ./deploy/update-s3.sh [bucket] [distribution-id] [region]
#   ./deploy/update-s3.sh --verify            # report what is live, upload nothing
#
# Env: WEA_BUCKET, WEA_DIST, WEA_URL, AWS_REGION, AWS_PROFILE
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

VERIFY_ONLY=""
if [[ "${1:-}" == "--verify" ]]; then VERIFY_ONLY="yes"; shift; fi

BUCKET="${1:-${WEA_BUCKET:-web-extraction-assistant-183300739663-eu-central-1-an}}"
DIST="${2:-${WEA_DIST:-E2PV4RBU3PC1SA}}"
REGION="${3:-${AWS_REGION:-eu-central-1}}"
URL="${WEA_URL:-https://d37827zcla3l1n.cloudfront.net}"

WANT="$(sed -n 's/.*"build"[^"]*"\([^"]*\)".*/\1/p' "$ROOT/version.json")"
[[ -n "$WANT" ]] || { echo "version.json holds no build number."; exit 1; }

# Report what the distribution is serving. Worth doing before and after an
# upload: a deploy that changed nothing looks exactly like one that worked.
live_build() {
  local html
  html="$(curl -fsS -m 30 "$URL/index.html?cachebust=$RANDOM" 2>/dev/null || true)"
  if [[ -z "$html" ]]; then echo "unreachable"; return; fi
  local id
  id="$(printf '%s' "$html" | sed -n 's/.*id="buildId">\([0-9]*\)<.*/\1/p' | head -1)"
  echo "${id:-unknown}"
}

echo "Bucket:       $BUCKET"
echo "Distribution: $DIST"
echo "Region:       $REGION"
echo "Local build:  $WANT"
echo "Live build:   $(live_build)"

if [[ -n "$VERIFY_ONLY" ]]; then
  # No -f here: a 403 is the answer being looked for, not a failure to get one.
  code="$(curl -sS -m 30 -o /dev/null -w '%{http_code}' "$URL/version.json?cachebust=$RANDOM" 2>/dev/null)"
  code="${code:-000}"
  echo "version.json: HTTP $code"
  [[ "$code" == "200" ]] || echo "  version.json is missing from the bucket, so the app cannot warn a"
  [[ "$code" == "200" ]] || echo "  reader that their browser is holding an older copy."
  exit 0
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI is not installed: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  exit 1
fi

if ! aws sts get-caller-identity --output text >/dev/null 2>&1; then
  echo
  echo "AWS credentials are missing or invalid."
  # Placeholder values left in the environment outrank every configured
  # profile, and the error they cause says nothing about where it came from.
  for var in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do
    value="${!var:-}"
    if [[ -n "$value" && "$value" =~ (YOUR|EXAMPLE|_KEY$|_HERE$|xxx|XXX|\<) ]]; then
      # Name the variable, and show the value only for the key id, which is
      # not a secret. A real secret must not be echoed even when it looks
      # like a placeholder.
      if [[ "$var" == "AWS_ACCESS_KEY_ID" ]]; then
        echo "  $var is set to a placeholder ($value). Run: unset $var"
      else
        echo "  $var is set to a placeholder. Run: unset $var"
      fi
    fi
  done
  echo "  SSO:  aws sso login --profile YOUR_PROFILE"
  echo "  Keys: aws configure"
  exit 1
fi

# Everything the browser loads, and nothing else. The test files and the
# Pages helper run under node and have no business on a web server.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/wea-update.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/css" "$STAGE/js" "$STAGE/vendor" "$STAGE/fixtures"
cp "$ROOT/index.html" "$ROOT/version.json" "$STAGE/"
cp -R "$ROOT/css/." "$STAGE/css/"
cp -R "$ROOT/js/." "$STAGE/js/"
cp -R "$ROOT/vendor/." "$STAGE/vendor/"
cp -R "$ROOT/fixtures/." "$STAGE/fixtures/"
rm -f "$STAGE/js/check-"*-node.js "$STAGE/js/push-pages.mjs"

# Assets are versioned by the ?v= query in index.html, so they can be held for
# a day. index.html and version.json decide which version a reader gets, so
# they must never be held.
echo "Uploading assets..."
aws s3 sync "$STAGE" "s3://$BUCKET" \
  --region "$REGION" \
  --size-only \
  --cache-control "public, max-age=86400" \
  --exclude "index.html" --exclude "version.json"

echo "Uploading index.html and version.json..."
aws s3 cp "$STAGE/index.html" "s3://$BUCKET/index.html" \
  --region "$REGION" --cache-control "no-cache" \
  --content-type "text/html; charset=utf-8"
aws s3 cp "$STAGE/version.json" "s3://$BUCKET/version.json" \
  --region "$REGION" --cache-control "no-cache" \
  --content-type "application/json"

echo "Invalidating CloudFront..."
ID="$(aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" \
  --query "Invalidation.Id" --output text)"
echo "  $ID"

# An invalidation takes a minute or two, so a check straight away proves
# nothing. Wait for it, then say what is actually being served.
echo "Waiting for the invalidation to finish..."
aws cloudfront wait invalidation-completed --distribution-id "$DIST" --id "$ID" || true

GOT="$(live_build)"
echo
if [[ "$GOT" == "$WANT" ]]; then
  echo "Deployed. $URL is serving build $GOT."
else
  echo "Uploaded, but $URL reports build ${GOT}, not ${WANT}."
  echo "Give the invalidation another minute, then: ./deploy/update-s3.sh --verify"
fi
echo
echo "A reader holding an older copy needs one hard reload (Cmd+Shift+R)."
