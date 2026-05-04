#!/usr/bin/env bash
# Auto-restart wrapper for HWK bulk enricher.
# Idempotent atomic-claim pattern => safe to restart many times.

set -u
CONCURRENCY="${1:-24}"
MAX_RESTARTS="${2:-200}"
RESTART_DELAY=5
FAST_FAIL_THRESHOLD=5

cd "$(dirname "$0")/.."
attempt=0
fast_fails=0

while [ "$attempt" -lt "$MAX_RESTARTS" ]; do
  attempt=$((attempt + 1))
  echo ""
  echo "=== HWK bulk attempt $attempt / $MAX_RESTARTS ==="
  echo "    started at $(date '+%H:%M:%S')"

  start_ts=$(date +%s)
  npx tsx src/seo-pipeline/hwkBulkEnricher.ts --concurrency "$CONCURRENCY"
  exit_code=$?
  end_ts=$(date +%s)
  elapsed=$((end_ts - start_ts))

  echo "    exited code=$exit_code after ${elapsed}s"

  if [ "$elapsed" -lt 30 ]; then
    fast_fails=$((fast_fails + 1))
    if [ "$fast_fails" -gt "$FAST_FAIL_THRESHOLD" ]; then
      echo "    too many fast failures - bailing out"
      break
    fi
  else
    fast_fails=0
  fi

  echo "    sleeping ${RESTART_DELAY}s before restart..."
  sleep "$RESTART_DELAY"
done

echo ""
echo "=== Loop finished after $attempt attempts ==="
