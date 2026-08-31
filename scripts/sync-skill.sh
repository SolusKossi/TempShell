#!/usr/bin/env bash
#
# Copy the live tempshell skill into this repo, or check that the two already match.
#
# The skill runs from ~/.claude/skills/tempshell-session, but ships from skills/ in
# this repo, so the two can drift silently: editing the live one does not touch
# the published copy, and a stale published copy is worse than none.
#
#   ./scripts/sync-skill.sh            copy live -> repo, show what changed
#   ./scripts/sync-skill.sh --check    report drift and exit 1, change nothing
#
# --check is the one to run before committing, or from CI.
set -euo pipefail

LIVE="${CLIP_SKILL_SRC:-$HOME/.claude/skills/tempshell-session}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/skills/tempshell-session"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

if [ ! -d "$LIVE" ]; then
  echo "no skill at $LIVE" >&2
  echo "  set CLIP_SKILL_SRC if it lives somewhere else." >&2
  exit 1
fi

mkdir -p "$REPO"
changed=0

for f in SKILL.md tempshell-run.sh tempshell-wait.sh tempshell-wait-arm.sh; do
  src="$LIVE/$f"
  dst="$REPO/$f"
  if [ ! -f "$src" ]; then
    echo "  missing in live skill: $f" >&2
    changed=1
    continue
  fi
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    printf '  same      %s\n' "$f"
    continue
  fi
  changed=1
  if [ "$CHECK" = 1 ]; then
    printf '  DRIFTED   %s\n' "$f"
    diff -u "$dst" "$src" 2>/dev/null | sed -n '3,15p' | sed 's/^/      /' || true
  else
    cp "$src" "$dst"
    printf '  copied    %s\n' "$f"
  fi
done

# Keep the shell helpers executable in the repo as well as on disk.
chmod +x "$REPO"/*.sh 2>/dev/null || true

# Nothing here should ever carry a hostname, an account name or a real token.
leaks="$(grep -rnoiE 'FM-[A-Z0-9]{6,}|CLOUDA~1|CloudAdmin[A-Za-z]*|[A-Za-z0-9_-]{40,}' "$REPO" || true)"
if [ -n "$leaks" ]; then
  echo "" >&2
  echo "possible identifier or token in the published copy:" >&2
  printf '%s\n' "$leaks" | sed 's/^/  /' >&2
  exit 1
fi

if [ "$CHECK" = 1 ] && [ "$changed" = 1 ]; then
  echo ""
  echo "repo copy is out of date. run ./scripts/sync-skill.sh to update it."
  exit 1
fi

echo ""
if [ "$changed" = 1 ]; then
  echo "skill synced. review with: git diff skills/"
else
  echo "skill already in sync."
fi
