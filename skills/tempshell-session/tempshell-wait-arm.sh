#!/usr/bin/env bash
#
# Blocks until an auto-run agent arms for a session, then prints the target it
# reported (host, PowerShell version, elevation).
#
# Run it in the FOREGROUND, in the same turn that handed over the arming code.
# A background task does not survive the end of your turn on every host (some
# start a fresh process per turn and kill what is still running), and nothing
# wakes you when one finishes, so "run it in the background and wait to be told"
# can end with [killed] and no notification.
#
# It returns within MAX seconds (default 540, under a typical 10 minute tool
# limit) either way:
#   armed          -> prints the session's autorun JSON (has "armed":true), exit 0
#   still waiting  -> prints {"armed":false,"still_waiting":true,...}, exit 2.
#                     Run it again while the arming code (15 min) is still valid.
#   gave up        -> prints {"armed":false,"gave_up":true,...} after 20 minutes.
#
#   bash ~/.claude/skills/tempshell-session/tempshell-wait-arm.sh <slug> [max_seconds]
#
set -euo pipefail

SLUG="${1:?usage: tempshell-wait-arm.sh <slug> [max_seconds]}"
MAX="${2:-540}"
# Which tempshell instance, and which token. Both are overridable so this works
# against any self-hosted instance, not only the author's:
#   TEMPSHELL_BASE (or CLIP_BASE), else ~/.claude/tempshell-base or clip-base, else https://c.313b.be
#   TEMPSHELL_TOKEN (or CLIP_TOKEN), else ~/.claude/tempshell-token, clip-token, or 313b-token
BASE="${TEMPSHELL_BASE:-${CLIP_BASE:-}}"
[ -z "$BASE" ] && for bf in "$HOME/.claude/tempshell-base" "$HOME/.claude/clip-base"; do [ -f "$bf" ] && { BASE="$(tr -d "[:space:]" < "$bf")"; break; }; done
[ -z "$BASE" ] && BASE="https://c.313b.be"

TOKEN="${TEMPSHELL_TOKEN:-${CLIP_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  for f in "$HOME/.claude/tempshell-token" "$HOME/.claude/clip-token" "$HOME/.claude/313b-token"; do
    [ -f "$f" ] && { TOKEN="$(tr -d "[:space:]" < "$f")"; break; }
  done
fi
if [ -z "$TOKEN" ]; then
  echo "no tempshell API token found." >&2
  echo "  put one in ~/.claude/tempshell-token, or set TEMPSHELL_TOKEN." >&2
  echo "  point at your own instance with ~/.claude/tempshell-base or TEMPSHELL_BASE (now: $BASE)." >&2
  exit 1
fi

# Never longer than 20 minutes (the arming code itself lasts 15), and never
# longer than MAX for this call.
CAP=1200
[ "$MAX" -gt "$CAP" ] && MAX=$CAP
END=$(( $(date +%s) + MAX ))

while [ "$(date +%s)" -lt "$END" ]; do
  R="$(curl -s --max-time 20 -H "Authorization: Bearer $TOKEN" "$BASE/api/sessions/$SLUG/autorun" || true)"
  if printf '%s' "$R" | grep -q '"armed":true'; then
    printf '%s\n' "$R"
    exit 0
  fi
  sleep 5
done

if [ "$MAX" -lt "$CAP" ]; then
  printf '{"armed":false,"still_waiting":true,"note":"not armed yet; run this again while the arming code is valid"}\n'
  exit 2
fi
printf '{"armed":false,"gave_up":true,"note":"agent did not arm within 20 minutes"}\n'
