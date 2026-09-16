#!/usr/bin/env bash
# Deploy the static browser app to private S3 + CloudFront (HTTPS).
# The URL is public to anyone who has it. Customer HTML still never leaves the browser.
#
# Prerequisites: AWS CLI v2, valid credentials (aws sso login or aws configure).
#
# Usage:
#   ./deploy/deploy-s3.sh [bucket-name] [region]
# Env:
#   AWS_PROFILE, STACK_NAME (default: wea-s3)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${2:-${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-central-1}}}"
STACK="${STACK_NAME:-wea-s3}"

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI is not installed. Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  exit 1
fi

if ! aws sts get-caller-identity --output text >/dev/null 2>&1; then
  echo "AWS credentials are missing or invalid."
  echo "  SSO:     aws sso login --profile YOUR_PROFILE"
  echo "  Keys:    aws configure"
  echo "Then re-run this script."
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${1:-wea-extraction-assistant-${ACCOUNT_ID}-${REGION}}"

echo "Account: $ACCOUNT_ID"
echo "Region:  $REGION"
echo "Bucket:  $BUCKET"
echo "Stack:   $STACK"

echo "Creating / updating CloudFormation stack..."
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$ROOT/deploy/s3-cloudfront.yaml" \
  --parameter-overrides "BucketName=$BUCKET" \
  --region "$REGION" \
  --no-fail-on-empty-changeset

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/wea-s3.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "Staging into $STAGE"
mkdir -p "$STAGE/css" "$STAGE/js" "$STAGE/vendor" "$STAGE/fixtures"
cp "$ROOT/index.html" "$STAGE/"
[[ -f "$ROOT/version.json" ]] && cp "$ROOT/version.json" "$STAGE/"
cp -R "$ROOT/css/." "$STAGE/css/"
cp -R "$ROOT/js/." "$STAGE/js/"
cp -R "$ROOT/vendor/." "$STAGE/vendor/"
cp -R "$ROOT/fixtures/." "$STAGE/fixtures/"
rm -f "$STAGE/js/check-"*-node.js "$STAGE/js/push-pages.mjs"

echo "Uploading to s3://$BUCKET ..."
aws s3 sync "$STAGE" "s3://$BUCKET" \
  --region "$REGION" \
  --delete \
  --cache-control "public, max-age=86400" \
  --exclude "index.html"

aws s3 cp "$STAGE/index.html" "s3://$BUCKET/index.html" \
  --region "$REGION" \
  --cache-control "no-cache" \
  --content-type "text/html; charset=utf-8"

DIST_ID="$(aws cloudformation describe-stacks \
  --stack-name "$STACK" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)"
APP_URL="$(aws cloudformation describe-stacks \
  --stack-name "$STACK" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue" \
  --output text)"

echo "Invalidating CloudFront cache..."
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null

echo
echo "Deployed: $APP_URL"
echo
echo "Note: this HTTPS URL is public. Do not treat it as Celonis-only."
echo "CloudFront can take a few minutes the first time."
