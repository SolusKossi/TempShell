#!/usr/bin/env bash
#
# Blocks until an auto-run agent arms for a session, then prints the target it
# reported (host, PowerShell version, elevation). Run it in the BACKGROUND after
# you enable auto-run and hand over the arming code: Claude is re-invoked the
# moment the person at the machine arms.
#
#   bash ~/.claude/skills/tempshell-session/tempshell-wait-arm.sh <slug>
#
set -euo pipefail

SLUG="${1:?usage: tempshell-wait-arm.sh <slug>}"
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

# Give up after 20 minutes (the arming code itself lasts 15).
END=$(( $(date +%s) + 1200 ))

while [ "$(date +%s)" -lt "$END" ]; do
  R="$(curl -s --max-time 20 -H "Authorization: Bearer $TOKEN" "$BASE/api/sessions/$SLUG/autorun" || true)"
  if printf '%s' "$R" | grep -q '"armed":true'; then
    printf '%s\n' "$R"
    exit 0
  fi
  sleep 5
done

printf '{"armed":false,"gave_up":true,"note":"agent did not arm within 20 minutes"}\n'
