#!/usr/bin/env bash
# Incrementally call POST /api/reindex until nextCursor is null.
#
# Usage:
#   chmod +x scripts/reindex-vercel-loop.sh
#   BASE_URL=https://passage-two.vercel.app ./scripts/reindex-vercel-loop.sh
#
# Resume behavior:
#   - By default, if STATE_FILE exists and has .nextCursor, script resumes from it.
#   - Set RESET=1 to ignore state and start from scratch.
#
# Optional env vars:
#   SECONDS_BETWEEN=2   # pause between requests (helps Voyage RPM limits)
#   STATE_FILE=last.json
#   MODIFIED_SINCE=2021-01-01T00:00:00Z

set -euo pipefail

BASE_URL="${BASE_URL:-https://passage-two.vercel.app}"
MODIFIED_SINCE="${MODIFIED_SINCE:-2021-01-01T00:00:00Z}"
SECONDS_BETWEEN="${SECONDS_BETWEEN:-1}"
STATE_FILE="${STATE_FILE:-last.json}"
RESET="${RESET:-0}"

command -v curl >/dev/null || { echo "Need curl"; exit 1; }
command -v jq >/dev/null || { echo "Need jq (brew install jq)"; exit 1; }

if [[ "$RESET" != "1" && -f "$STATE_FILE" ]]; then
  if jq -e '.nextCursor and .nextCursor != null' "$STATE_FILE" >/dev/null 2>&1; then
    echo "Resuming from $STATE_FILE nextCursor..."
    CURSOR=$(jq -c '.nextCursor' "$STATE_FILE")
    BODY=$(jq -n --arg ms "$MODIFIED_SINCE" --argjson cur "$CURSOR" \
      '{modifiedSinceISO:$ms, cursor:$cur}')
  else
    echo "$STATE_FILE exists but has no resumable nextCursor. Starting fresh."
    BODY=$(jq -n --arg ms "$MODIFIED_SINCE" '{modifiedSinceISO:$ms}')
  fi
else
  if [[ "$RESET" == "1" ]]; then
    echo "RESET=1, starting fresh and ignoring $STATE_FILE."
  fi
  BODY=$(jq -n --arg ms "$MODIFIED_SINCE" '{modifiedSinceISO:$ms}')
fi

ROUND=0

while true; do
  ROUND=$((ROUND + 1))
  echo "--- Request #$ROUND ---"
  RESP=$(curl -sS -X POST "$BASE_URL/api/reindex" \
    -H "Content-Type: application/json" \
    -d "$BODY")

  echo "$RESP" | jq .
  echo "$RESP" > "$STATE_FILE"

  OK=$(echo "$RESP" | jq -r '.ok // false')
  if [ "$OK" != "true" ]; then
    echo "Stopping on error. Last response saved to $STATE_FILE" >&2
    exit 1
  fi

  NEXT=$(echo "$RESP" | jq -c '.nextCursor // null')
  if [ "$NEXT" = "null" ]; then
    echo "Done — nextCursor is null. Final response saved to $STATE_FILE"
    exit 0
  fi

  BODY=$(jq -n --arg ms "$MODIFIED_SINCE" --argjson cur "$NEXT" \
    '{modifiedSinceISO:$ms, cursor:$cur}')

  sleep "$SECONDS_BETWEEN"
done
