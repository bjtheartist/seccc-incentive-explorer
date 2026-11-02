#!/usr/bin/env bash
# Run every gate, retain the full log, and return the real aggregate result.
# The workflow opens the review PR with !cancelled() even when this step fails.
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

# A pipeline runs its left side in a subshell. Communicate the result through
# its EXIT STATUS, never a variable read by the parent after `| tee` (#417).
if (
  status=0
  echo "### manifest";  npm run data:manifest:verify || status=1
  echo "### lint";      npm run lint                 || status=1
  echo "### test";      npm test                     || status=1
  echo "### typecheck"; npx tsc --noEmit              || status=1
  echo "### build";     npm run build -- --webpack    || status=1
  exit "$status"
) 2>&1 | tee "$RUNNER_TEMP/verify.log"; then
  echo "verify_failed=false" >> "$GITHUB_OUTPUT"
else
  echo "verify_failed=true" >> "$GITHUB_OUTPUT"
  echo "::error::Refresh verification failed — see verify.log and the review PR"
  exit 1
fi
