#!/usr/bin/env bash
#
# Post one command and block until THIS command's own result comes back, then
# print that result entry as JSON. One call instead of post + spawn-waiter +
# read-file, and no LAST_SEQ to get wrong, the command's own seq is the anchor.
#
# The command is sent as text/plain, so Windows paths and multi-line blocks need
# NO escaping. Pass the command on stdin (preferred, with printf '%s') or as the
# 2nd argument.
#
#   printf '%s' 'Get-ChildItem "C:\Program Files"' | bash tempshell-run.sh <slug>
#   bash tempshell-run.sh <slug> 'whoami'
#
# Run it in the BACKGROUND: you are re-invoked when the result lands.
#
# It waits for the entry that actually answers this command, an auto-run result,
# or a human's typed reply on the manual path, and skips anything else posted
# meanwhile (a screenshot, a note, your own posts). So a mid-run screenshot no
# longer gets mistaken for the command's output. (A manual answer given ONLY as a
# screenshot, with no text, will not release the wait, read the thread for that.)
set -euo pipefail

# --help before anything else: requiring the slug first would make `--help` read
# stdin and hang, which is exactly the trap this text warns about.
case "${1:-}" in
  -h|--help)
    cat <<'USAGE'
tempshell-run.sh <slug> [command] [options]        (command on stdin is preferred)

  --intent TEXT   what this step does, shown live on the session page
  --why TEXT      why it is being done, shown live
  --risk risky    hold the command until a human at the machine approves it
  --field PATH    print only that value from the reply, e.g. result.status
  --quiet         status/exit/duration, then stdout, then stderr
  --dry-run       show how the step will appear on the page; posts nothing
  -h, --help      this text

THIS POSTS A COMMAND THAT RUNS ON SOMEONE ELSE'S MACHINE.
  - It waits up to 30 minutes for the reply. Your Bash tool timeout is the real
    deadline: if yours fires first the command STILL RUNS on the target and you
    lose the answer. Give the tool a generous timeout and run this in background.
  - Do not pipe this into anything you have not verified exists. jq is NOT
    installed everywhere, and a missing binary exits 127 AFTER the command has
    already run remotely. Use --field instead.
  - The agent runs as the account that armed it, often an elevated admin, so
    %TEMP% and $env:USERPROFILE are that account's, not the logged-in user's.
USAGE
    exit 0 ;;
esac

SLUG="${1:?usage: tempshell-run.sh <slug> [command] [options]   (see --help)}"
shift
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

# --intent / --why build the action log on the session page; --risk risky holds
# the command until someone at the machine approves it.
INTENT=""; WHY=""; RISK=""; POSCMD=""; QUIET=0; FIELD=""; DRYRUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --intent) INTENT="${2:-}"; shift 2 ;;
    --why)    WHY="${2:-}";    shift 2 ;;
    --risk)   RISK="${2:-}";   shift 2 ;;
    --quiet)  QUIET=1;         shift ;;
    --field)  FIELD="${2:-}";  shift 2 ;;
    --dry-run|--peek) DRYRUN=1; shift ;;
    *)        POSCMD="$1";     shift ;;
  esac
done

if [ "$POSCMD" != "" ]; then CMD="$POSCMD"; else CMD="$(cat)"; fi
if [ -z "${CMD//[[:space:]]/}" ]; then echo '{"error":"empty command"}'; exit 1; fi

if [ "$DRYRUN" = "1" ]; then
  # Show what the session page will show, without touching the target machine.
  echo "DRY RUN, nothing was posted."
  echo "  intent : ${INTENT:-(none, so the page falls back to the first line of the command)}"
  echo "  why    : ${WHY:-(none)}"
  if [ "$RISK" = "risky" ]; then
    echo "  risk   : risky, so it is HELD until someone presses Approve"
  else
    echo "  risk   : ${RISK:-safe}, runs as soon as the agent picks it up"
  fi
  echo "  command:"
  printf '%s' "$CMD" | sed 's/^/    /'
  echo
  exit 0
fi

# urlencode for the query string (the command itself still goes as raw text/plain)
enc() { printf '%s' "$1" | od -An -tx1 -v | tr -d '\n ' | sed 's/\(..\)/%\1/g'; }
QS="lang=powershell"
[ -n "$INTENT" ] && QS="$QS&intent=$(enc "$INTENT")"
[ -n "$WHY" ]    && QS="$QS&why=$(enc "$WHY")"
[ -n "$RISK" ]   && QS="$QS&risk=$(enc "$RISK")"

have_node=1; command -v node >/dev/null 2>&1 || have_node=0

# --- post, separating a transport failure from the response body -------------
# A non-2xx is the only thing that means "the command did not land". Parsing the
# body is a separate concern, reported separately, so a shape change or a missing
# tool never masquerades as "post failed" while the machine is already running it.
TMP="$(mktemp)"
HTTP="$(printf '%s' "$CMD" | curl -s -o "$TMP" -w '%{http_code}' --max-time 25 \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: text/plain; charset=utf-8' --data-binary @- \
  "$BASE/api/sessions/$SLUG/command?$QS")"
POST="$(cat "$TMP")"; rm -f "$TMP"

case "$HTTP" in
  2*) : ;;
  *) printf '{"error":"post failed","http":%s,"body_prefix":"%s"}\n' \
       "$HTTP" "$(printf '%s' "$POST" | head -c 300 | tr -d '\n')"; exit 1 ;;
esac

if [ "$have_node" = 1 ]; then
  SEQ="$(printf '%s' "$POST" | node -pe "try{JSON.parse(require('fs').readFileSync(0)).seq}catch(e){''}" 2>/dev/null || true)"
else
  SEQ="$(printf '%s' "$POST" | grep -o '"seq":[0-9]*' | head -1 | grep -o '[0-9]*' || true)"
fi
if [ -z "$SEQ" ]; then
  printf '{"error":"posted OK but could not read seq","http":%s,"body_prefix":"%s"}\n' \
    "$HTTP" "$(printf '%s' "$POST" | head -c 300 | tr -d '\n')"; exit 1
fi

# --- say what just happened, on stderr ---------------------------------------
# stdout stays pure JSON for the caller. Without this the output stayed empty
# until the command finished, so "queued", "running", "held for approval" and
# "the agent died" were indistinguishable, and a held command read as a hang.
if [ "$have_node" = 1 ]; then
  APPROVAL="$(printf '%s' "$POST" | node -pe "try{JSON.parse(require('fs').readFileSync(0)).approval||''}catch(e){''}" 2>/dev/null || true)"
  REASON="$(printf '%s' "$POST" | node -pe "try{JSON.parse(require('fs').readFileSync(0)).risk_reason||''}catch(e){''}" 2>/dev/null || true)"
else
  APPROVAL="$(printf '%s' "$POST" | grep -o '"approval":"[a-z]*"' | head -1 | sed 's/.*:"//;s/"//' || true)"
  REASON="$(printf '%s' "$POST" | grep -o '"risk_reason":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//' || true)"
fi

if [ "$APPROVAL" = "pending" ]; then
  echo "tempshell: seq $SEQ is HELD FOR APPROVAL - ${REASON:-flagged as risky}" >&2
  echo "  Nothing is stuck. Someone at the machine must press Approve at $BASE/s/$SLUG" >&2
  echo "  Tell the user that now, and do not re-post the command." >&2
else
  echo "tempshell: posted seq $SEQ, waiting for the result..." >&2
fi

# --- wait for the entry that answers THIS command ----------------------------
SINCE="$SEQ"
END=$(( $(date +%s) + 1800 ))
while [ "$(date +%s)" -lt "$END" ]; do
  R="$(curl -s --max-time 315 -H "Authorization: Bearer $TOKEN" \
      "$BASE/api/sessions/$SLUG/wait?since=$SINCE&timeout=300&compact=1" || true)"
  [ -z "$R" ] && continue

  if [ "$have_node" = 1 ]; then
    DECISION="$(printf '%s' "$R" | SINCE="$SINCE" CMDSEQ="$SEQ" node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        let j; try { j = JSON.parse(s); } catch(e) { console.log("RETRY "+(process.env.SINCE||0)); return; }
        const ents = j.entries || [];
        const cmdSeq = Number(process.env.CMDSEQ);
        let maxseq = Number(process.env.SINCE || 0);
        for (const e of ents) { if (typeof e.seq === "number" && e.seq > maxseq) maxseq = e.seq; }
        // An auto result must answer THIS command. With two commands in flight the
        // other one finishing first would otherwise be returned as our answer, and
        // our real reply would never be shown. Human replies on the manual path
        // carry no in_reply_to, so they keep the looser match.
        const ans = ents.find(e =>
          (e.author === "auto" && e.result && e.in_reply_to === cmdSeq) ||
          ((e.author === "guest" || e.author === "admin") && e.kind !== "file" && e.kind !== "note"));
        console.log(ans ? ("MATCH " + JSON.stringify(ans)) : ("RETRY " + maxseq));
      });' 2>/dev/null || true)"
    if [ -z "$DECISION" ]; then continue; fi
    if [ "${DECISION%% *}" = "MATCH" ]; then
      if [ "$QUIET" = 1 ]; then
        # Just the parts you actually read: status, then each stream if non-empty.
        printf '%s' "${DECISION#* }" | node -e '
          let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
            let e; try { e = JSON.parse(s); } catch (err) { process.stdout.write(s); return; }
            const r = e.result || {};
            const bits = ["status=" + (r.status || "?")];
            if (r.exit_code !== null && r.exit_code !== undefined) bits.push("exit=" + r.exit_code);
            if (r.duration_ms != null) bits.push((r.duration_ms/1000).toFixed(1) + "s");
            if (r.truncated) bits.push("TRUNCATED");
            console.log(bits.join("  "));
            if (r.stdout && r.stdout.trim()) console.log(r.stdout.replace(/\s+$/, ""));
            if (r.stderr && r.stderr.trim()) console.log("[stderr]\n" + r.stderr.replace(/\s+$/, ""));
          });'
      elif [ -n "$FIELD" ]; then
        # One value out of the reply, so a 100 KB result costs nothing.
        # Uses node because jq is not installed on this fleet.
        printf '%s' "${DECISION#* }" | FIELD="$FIELD" node -e '
          let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
            let v; try { v = JSON.parse(s); } catch (e) { console.log(""); return; }
            for (const k of process.env.FIELD.split(".")) { if (v == null) break; v = v[k]; }
            if (v === undefined || v === null) console.log("");
            else if (typeof v === "object") console.log(JSON.stringify(v));
            else console.log(String(v));
          });'
      else
        printf '%s\n' "${DECISION#* }"
      fi
      exit 0
    fi
    SINCE="${DECISION#* }"
  else
    # No node: coarse fallback, take an auto result, else keep waiting.
    if printf '%s' "$R" | grep -q '"author":"auto"'; then printf '%s\n' "$R"; exit 0; fi
  fi
done
printf '{"timed_out":true,"gave_up":true,"posted_seq":%s}\n' "$SEQ"
