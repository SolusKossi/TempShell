#!/usr/bin/env bash
#
# Blocks until the human pastes a reply into a tempshell session, then prints the
# reply JSON and exits. Loops across the server's own long-poll timeouts, so a
# single invocation never returns empty-handed the way a bare /wait call can.
#
# Run it in the BACKGROUND from the skill: Claude is re-invoked with this
# output the instant a reply arrives, which is what stops it stalling.
#
#   bash ~/.claude/skills/tempshell-session/tempshell-wait.sh <slug> [since-seq]
#
set -euo pipefail

SLUG="${1:?usage: tempshell-wait.sh <slug> [since-seq]}"
SINCE="${2:-0}"
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

# Give up after 30 minutes so a forgotten session cannot poll forever.
END=$(( $(date +%s) + 1800 ))

while [ "$(date +%s)" -lt "$END" ]; do
  R="$(curl -s --max-time 315 -H "Authorization: Bearer $TOKEN" \
        "$BASE/api/sessions/$SLUG/wait?since=$SINCE&timeout=300" || true)"
  # A real reply carries "timed_out":false. Anything else means keep waiting.
  if printf '%s' "$R" | grep -q '"timed_out":false'; then
    printf '%s\n' "$R"
    exit 0
  fi
done

printf '{"timed_out":true,"gave_up":true,"note":"no reply in 30 minutes"}\n'
