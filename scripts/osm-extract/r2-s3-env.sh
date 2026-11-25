#!/usr/bin/env bash
# S3 API credentials for R2 from the Cloudflare API token the workflow already has (25 Nov), so large files go up by
# multipart upload (wrangler's r2 object put stops at 300 MiB; the UK's biggest buildings files are larger).
# Cloudflare: the Access Key ID is the token's id; the Secret Access Key is the SHA-256 of the token's value.
# Prints them as export lines, for eval in the same step, and adds them to $GITHUB_ENV for later steps. The
# workflow masks the secret in logs. Needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
api=https://api.cloudflare.com/client/v4
id=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api/user/tokens/verify" | jq -r '.result.id // empty')
# An account-owned token verifies under the account instead.
[ -n "$id" ] || id=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify" | jq -r '.result.id // empty')
[ -n "$id" ] || { echo "::error::Couldn't read the Cloudflare token's id (needed for R2's S3 API)"; exit 1; }
secret=$(printf '%s' "$CLOUDFLARE_API_TOKEN" | sha256sum | cut -d' ' -f1)
vars=$({
  echo "AWS_ACCESS_KEY_ID=$id"
  echo "AWS_SECRET_ACCESS_KEY=$secret"
  echo "AWS_DEFAULT_REGION=auto"
  echo "R2_ENDPOINT=https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com"
  # Newer AWS CLIs add checksums R2 doesn't always accept; send them only when an operation requires one.
  echo "AWS_REQUEST_CHECKSUM_CALCULATION=when_required"
  echo "AWS_RESPONSE_CHECKSUM_VALIDATION=when_required"
})
[ -n "${GITHUB_ENV:-}" ] && printf '%s\n' "$vars" >> "$GITHUB_ENV"
printf '%s\n' "$vars" | sed 's/^/export /' 
