---
name: tempshell-session
description: Run a command-and-response troubleshooting loop with the user against a machine they have no shell on, such as a test PC, a colleague's laptop, or a locked-down work machine. By default a small PowerShell agent on the target runs each command and posts the output back on its own; you block until the reply lands. Manual copy-paste is a fallback the user has to ask for. Works through a self-hosted tempshell instance. Use whenever you need to run diagnostics on a machine that is not the one you are running on, or when the user says "start a tempshell session", "troubleshoot the test PC", or asks you to walk them through fixing something on another computer.
---

# tempshell session

A troubleshooting loop over a self-hosted tempshell instance, against a machine you have
no shell on.
**The default is auto-run:** a small PowerShell agent on the target runs each
command you post and sends the output back by itself, so you are not waiting on a
human to copy and paste. **Manual copy-paste is a fallback**, used only when the user
specifically asks, or when the agent cannot run there (see the bottom section). Everything below is written for the auto-run path unless it says otherwise.

## The default loop (auto-run)

**It executes your commands on the target machine with no per-command
confirmation.** So only start once the user has agreed, keep every command safe to
run unattended, and never do anything destructive without asking in chat first.

### 0. Point at an instance

tempshell is self-hosted, so there is no shared service: **an instance is one person's
box, and an API token only works on the instance it came from.** Read both from
config rather than assuming, and use them in every example below:

```bash
BASE=$(cat "$HOME/.claude/clip-base" 2>/dev/null || echo "https://c.313b.be")
TOKEN=$(cat "$HOME/.claude/clip-token" 2>/dev/null || cat "$HOME/.claude/313b-token")
```

The helper scripts resolve the same way on their own (`TEMPSHELL_BASE` / `TEMPSHELL_TOKEN`
first, then those files), so you never pass a URL to them.

If no token file exists, there is no instance to talk to yet. Say so rather than
guessing: the user either self-hosts one (the project README covers deploying it)
or has a token for someone else's. `c.313b.be` is the author's private box and will
reject an unknown token, so it is a default, not a service to sign up for.

### 1. Create a session, titled after the actual problem

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json'   -d '{"title":"Intune sync on the test PC"}'   "$BASE/api/sessions"
```

Returns `{slug, code, url}`. Every call needs `Authorization: Bearer $TOKEN`.

Titles keep Unicode, but **your shell can mangle non-ASCII inside an inline
`-d '{...}'` string**. If the title has Norwegian letters, pipe it instead so the
bytes survive: `printf '%s' '{"title":"Arsoppgjor pa PCen"}' | curl ... --data-binary @-`.

### 2. Turn on auto-run and relay the two codes

```bash
curl -s -H "Authorization: Bearer $TOKEN" -X POST \
  "$BASE/api/sessions/$SLUG/autorun"
```

Returns `{arming_code, join_code, ...}`. Both codes are **four digits**. The
**arming code** is the security of the whole thing: it is shown only to you (the
token holder), so it reaches the machine solely by you passing it on. Relay both
codes and these three steps:

1. Open the instance home page on the target machine (the `url` from step 1 without
   its `/s/...` path) and enter the **join code**.
2. Click **Copy PowerShell agent** and paste the whole thing into a **PowerShell**
   window. An *elevated* window is preferred but not required; it arms and runs in
   plain Windows PowerShell 5.1, non-elevated, which is the normal case here.
3. When it asks for an arming code, enter the **arming code** you passed on.

The agent paints a small live dashboard (status, current command, a looping loader
while a command runs, last result). The person at the machine does not have to read
or do anything in it, just leave the window open.

### 3. Wait for it to arm (background task)

```bash
bash ~/.claude/skills/tempshell-session/tempshell-wait-arm.sh $SLUG
```

Run it **as a background task**: you are woken the moment it arms, and it prints the
target it reported, so you learn the shell version and whether it is elevated
*before* your first command. If `target.elevated` is false, say so: admin-only checks
will fail, and offer to have the agent re-run in an elevated window. The
arming code lasts **15 minutes**; if it lapses before they arm, `POST .../autorun`
again for a fresh one.

### 4. Say what you are doing, every time

Every command you post **must** carry `intent` (what this does) and `why` (the
reason), each one short line. They build the task summary on the session page, shown
live as you post it, so whoever is at the machine can follow the chain of actions
without decoding raw PowerShell, and read it back afterwards as a record. Write them
for that human reader. A step with no intent shows up as a bare command and makes the
log useless.

Add `risk=risky` to anything that **changes the machine or could lose work**:
restarting or stopping a service, deleting or overwriting files, registry writes,
`gpupdate /force`, uninstalling, killing processes, anything with `-Force`. A risky
command is **held**: it is never sent to the agent until someone at the machine
presses Approve. Read-only checks (`Get-*`, `Test-*`, reading logs) are `safe`, so
don't flag those, or the approvals become noise and get rubber-stamped.

```bash
printf '%s' 'Restart-Service W32Time -Force' \
  | bash ~/.claude/skills/tempshell-session/tempshell-run.sh $SLUG \
      --intent "Restart the time service" \
      --why "It is stopped, and that blocks Intune enrolment" \
      --risk risky
```

The post response tells you which happened: `"approval":"pending"` means it is
waiting on a human; `null` means it is already on its way. Nothing self-approves,
including the owner's own machine: a held command runs only after someone presses
Approve on the page, and the entry then records `approval_decided_by` and
`approval_decided_at`, so a fast approval is a fast human, not a bypass. While it
waits, the agent is deliberately idle, **not** stuck. If it is denied you get a normal reply
with `status:"denied"` and `stderr:"Denied at the machine..."`, so you are never left
hanging: acknowledge it, don't re-post the same command, and ask what to do instead.

### 5. Post commands, which run on their own

Post as raw text and block for that command's own result. Prefer `tempshell-run.sh`: it
posts as `text/plain` (no escaping) and waits for the reply, printing the JSON.

```bash
printf '%s' 'Get-ChildItem "C:\Program Files" | Select-Object Name' \
  | bash ~/.claude/skills/tempshell-session/tempshell-run.sh $SLUG
```

Run it **as a background task**: you are re-invoked the moment the result lands, so
you never stop and wait to be told it finished. If it prints `"gave_up":true` (30
min), check in. Auto-run replies are tagged `author: "auto"`.

**Pull one value out with `--field` instead of printing the whole reply.** Takes a
dotted path into the reply JSON and prints just that, so a 100 KB result costs you
nothing:

```bash
printf '%s' 'Get-ChildItem -Recurse C:\Windows\System32 | Measure-Object' \
  | bash ~/.claude/skills/tempshell-session/tempshell-run.sh $SLUG --field result.status
```

Useful paths: `result.status`, `result.exit_code`, `result.truncated`,
`result.duration_ms`, `result.stderr`, `errors` (`--field result.errors`). It uses
node, not `jq`.

**Add `--quiet` unless you need the raw JSON.** It prints just
`status / exit / duration`, then stdout, then stderr under a `[stderr]` marker. The
full reply is one JSON line that can reach ~100 KB on a large result, and at roughly
four characters per token that is about 25k tokens of your context. `tempshell-run.sh`
already requests the compact form, so the reply carries one copy of the output.

**Never pipe `tempshell-run.sh` into anything you have not verified exists.** Posting the
command is a side effect on someone else's machine: it runs there whether or not your
local pipeline survives. If the right-hand side of the pipe is missing (`jq` is NOT
installed everywhere, and a missing binary exits 127), the command has still
executed on the target and you have only lost your copy of the answer. Use
`--field` below, or re-read the result from the thread, rather than piping.

**Give the Bash tool a longer timeout than you think you need.** `tempshell-run.sh` waits
up to 30 minutes internally, but your tool timeout is the real deadline: if it fires
first you lose the result even though the command ran.

**Keep one command in flight.** `tempshell-run.sh` matches the reply to your command's own
seq, so a slower earlier command finishing first is never mistaken for your answer.
Two caveats worth knowing:

- **`tempshell-wait.sh` does NOT match on seq.** It releases on any newer entry, so with
  two things in flight it will hand you the wrong reply. Only `tempshell-run.sh` correlates
  by `in_reply_to`. Prefer `tempshell-run.sh`.
- **The queue is not strictly FIFO.** A command held for approval does not block the
  ones behind it: safe commands overtake it and run while it waits.

> **Pipe with `printf '%s'`, never bare `printf`.** Bare `printf 'C:\nope\total'`
> interprets `\n`, `\t`, `\0...` as escapes, so your path silently grows a newline and a
> tab. `printf '%s'` passes the string through verbatim, which is what you want for a
> Windows path or a format string. (`tempshell-run.sh` reads the whole body literally, so
> the only place this bites is how *you* feed it.)

### 6. Say when the task is finished

When the work is done, mark it complete so the page says so. Without this a finished
run just looks like the agent vanished, which reads as a failure:

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"note":"Time service restarted; Intune sync now succeeds."}' \
  "$BASE/api/sessions/$SLUG/complete"
```

The note is one line: what was actually achieved. Then stop auto-run.

## Reading auto-run results

An `auto` entry carries a structured `result` object, plus `in_reply_to` (the seq
of the command it answers) on the entry itself:

```json
"in_reply_to": 7,
"result": { "stdout": "...", "stderr": "...", "exit_code": null, "duration_ms": 812,
            "truncated": false, "status": "error", "had_errors": true,
            "errors": [ { "message": "Cannot find path '...' because it does not exist.",
                          "fq_error_id": "PathNotFound,Microsoft.PowerShell.Commands.GetItemCommand",
                          "category": "ObjectNotFound",
                          "exception_type": "System.Management.Automation.ItemNotFoundException",
                          "target": "C:\\...", "script_line": 2 } ] }
```

- **Read `stderr` separately.** A PowerShell error record is the signal in a
  troubleshooting session; it is kept apart from `stdout` so you do not have to guess.
- **Do not trust `exit_code` alone.** Many PowerShell failures leave the exit code
  at 0. `status` is **`error`** when an error record was left unhandled on the error
  stream, a terminating error escaped, the script failed to parse, it called `exit`,
  or a native process exited non-zero. Treat `status: "error"` as a failure
  regardless of `exit_code`.
- **Errors your command handles do not count against it.** A `try/catch` that
  catches, or `-ErrorAction SilentlyContinue` that suppresses, still leaves
  `status: "ok"`: the run did what you asked. Only errors that actually escaped are
  reported, so defensive commands (exactly what you should write for an unattended
  agent) do not come back looking like failures.
- **`exit_code` reflects native process exits, and is `null` otherwise.** A native
  tool's code propagates (`cmd /c "... exit 3"` → `exit_code: 3`) and a non-zero native
  exit is flagged `status: "error"`. A pure-PowerShell command has no process exit, so
  `exit_code` is **`null`**: not `0`. Never branch on `exit_code === 0`; branch on
  `status`.
- **The agent runs as the account that armed it, not as the logged-in user.** If it
  was pasted into an elevated admin window, `%TEMP%`, `$env:USERPROFILE` and `$HOME`
  all resolve to *that* account (an admin profile such as `C:\Users\ADMIN~1\...`), not to
  the person sitting at the machine. Never write anything user-profile-relative and
  assume it lands in the user's profile: use an absolute path, or resolve the real
  target explicitly.
- **`$env:USERNAME` can lie.** It has come back as `SYSTEM` while the
  real identity was an AzureAD admin account, because the variable was inherited from
  a stale parent process. For identity, always use
  `[Security.Principal.WindowsIdentity]::GetCurrent().Name`. Anything branching on
  `$env:USERNAME` can be silently wrong.
- **A warning is not a failure.** `Write-Warning`, `Write-Verbose` and `Write-Debug`
  are captured into `stderr` prefixed with `WARNING:` / `VERBOSE:` / `DEBUG:`, while
  `status` stays `ok`. So non-empty `stderr` does not by itself mean trouble: branch
  on `status`, and read `stderr` for detail. Ordering: warnings are appended as a
trailing block, so a warning that ran *before* a failing command still shows *after*
that command's error in `stderr`, the same reordering as `Write-Host` in `stdout`.
- **`errors[]` is the structured form of the error stream.** Each record carries
  `message`, `fq_error_id`, `category`, `exception_type`, `target`, and a `script_line`
  relative to *your* command (not the agent). This is what tells access-denied
  (`category: "PermissionDenied"`) from a genuinely absent path (`"ObjectNotFound"`)
  without a second round trip: worth reading before you re-run on a non-elevated
  agent. `stderr` stays the human-readable version and no longer leaks agent-harness
  stack frames.
- **`status`** is `ok`, `error`, or `timeout`. Each command has a **120 s timeout** on
  the agent; a hung command comes back `status: "timeout"` rather than blocking the
  loop: and any output produced before the hang is preserved in `stdout`, not
  discarded.
- **Print something even on success is a correctness rule, not style.** A command
  that legitimately emits nothing returns an empty `ok`: indistinguishable from a
  check that matched nothing. Make every command print a result (`... | Out-String`,
  an explicit `"ok: $x"`), so an empty `stdout` always means "nothing to report",
  never "did it even run".
- **Prefer `Write-Output` / plain strings over `Write-Host`.** Write-Host is captured
  on the information stream and appended to `stdout` as a **trailing block**, out of
  order with the pipeline output: so a `Write-Host "=== section ==="` marker ends up
  detached from the lines it was meant to label. Use plain string output (`"=== section ==="`)
  for anything whose position matters.
- **`result.errors` is always present** (possibly `[]`), so `result.errors.length` is
  safe. It is populated for non-terminating failures too: an ordinary
  `Get-Item <missing>` gives one record with `category: "ObjectNotFound"`, not just
  terminating ones.
- **`truncated`** is true when a stream overflowed the 100 000-char cap. Truncation
  keeps the **head and the tail** (60k + 40k) with a `[tempshell trimmed N chars]` marker
  between, since exceptions and summaries land at the end of console output. Still,
  never ask auto-run for an unbounded dump like `Get-ChildItem -Recurse C:\`.

**The reply duplicates the output**: the flattened `body` and `result.stdout`/
`result.stderr` carry the same text. When you only need the structured half, ask the
server to drop `body`: add `?compact=1` (or `?fields=result`) to `GET
/api/sessions/$SLUG` and to the `/wait` endpoint, and entries with a `result` omit
`body`. `tempshell-run.sh` already returns the whole reply; use compact when you fetch the
thread yourself and want it lean.

## Checking the target

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/sessions/$SLUG/autorun"
```

`target` gives `{host, ps_version, elevated}`; `state` is one of `off`,
`waiting-to-arm`, `armed`, `stopped`.

- **`ps_version` will almost always be 5.1.** Read it to confirm, but write for 5.1
  from the start (see the PowerShell rules below).
- **`elevated` may be false.** Anything needing admin (many Intune, service, and
  `HKLM` writes) fails with access denied. Ask for the agent to be re-run in an admin
  window if you need elevation, rather than discovering it three commands in. There is
  no in-place elevation step: re-arming in an elevated window is the way up.
- **`pending_command_seqs`** lists commands not yet reported done. If one lingers
  there while the agent is armed and `last_seen` is advancing, it is genuinely stuck;
  say so rather than waiting silently.

### Turning it off

```bash
curl -s -H "Authorization: Bearer $TOKEN" -X POST \
  "$BASE/api/sessions/$SLUG/autorun/stop"
```

The agent sees the stop on its next poll and exits. Always stop auto-run when you are
done, so a machine is never left with a live unattended shell.

## Writing commands (applies to both paths)

**Assume Windows PowerShell 5.1 and write for it.** Effectively every machine in this
fleet runs 5.1: Windows Terminal is the host, but the shell inside it is still
Windows PowerShell. Do not use the PS7 ternary `$x ? 'a': 'b'`, `??`, `?.`, or
`Get-Error`; they are syntax errors or missing cmdlets on 5.1. Write `if/else` on one
line: `if ($x) { 'yes' } else { 'no' }`, or `$(if ($x) {'a'} else {'b'})`. Only reach
for PS7-only syntax after `ps_version` has actually come back as 7.x for that session.

**`>` is redirection, never comparison.** On 5.1 (and 7), `$n > 5` does not compare;
it writes `$n` to a **file named `5`** in the working directory (often `C:\Users\<user>`),
silently, exit 0, no output. The comparison operators are `-gt -lt -ge -le -eq -ne`. A
model reaching for a compact `$n > 5 ? 'a': 'b'` on an unattended agent creates a
stray file instead of erroring. Never use `<` `>` in a comparison position; use `-gt`
/ `-lt`.

**One command per post.** One command in, one result out. Two commands in one block
means two outputs tangled together.

**No state carries between commands.** Each command runs in its own fresh runspace,
so a `$var` set in one command is gone in the next, `Set-Location` does not persist,
and `$ErrorActionPreference` set in one command cannot leak into another. If a step
depends on earlier state, put it all in one command (a multi-line block is fine on
auto-run). This is deliberate: it keeps each command's result honest: but it does
mean you cannot set up context in one round and use it in the next.

**Multi-line is fine on auto-run.** The agent runs each command as a whole *script
block*, so multi-line `if/else`, `foreach`, `try/catch`, `switch`, and here-strings
execute correctly. You only have to flatten to one line on the manual fallback (where
a pasted block runs line by line and breaks apart). Flattening never hurts, so when in
doubt a one-liner works on both.

**No escaping to worry about** when you post as `text/plain` (which `tempshell-run.sh`
does). A Windows path or a format string like `-Format "d\.hh\:mm"` goes through
untouched. Only a JSON body needs backslashes and quotes escaped: so don't hand-build
JSON with a Windows path in it; use `text/plain` or `{"body_b64":"<base64>"}`. A
malformed JSON body returns **400 with the exact parse position**; if you see that,
switch to `text/plain`.

## Getting output back that is readable

The result is console text, so shape it before it is printed.

- **`Format-List` or `Select-Object` over `Format-Table`.** Wide tables wrap and
  become unreadable.
- **Cap the length.** `Select-Object -First 20`. Never ask for a full event log.
- **Print something even on success.** Silence is ambiguous when you cannot see the
  screen: you cannot tell a passing check from a command that did not run.
- **Check elevation up front.** Many Intune, service, and registry checks need an
  admin shell. If `target.elevated` is false and you need admin, ask for the agent
  to be re-armed elevated before you go deep.

## Screenshots

Whether auto-run is on or not, anyone in the session can **paste an image straight
into the session box** with Ctrl+V, or drop a file anywhere on the page. Ask for one whenever the problem is
a GUI: a dialog, an error toast, a settings pane, a Device Manager tree. Describing
those back in text loses most of the information.

An entry with an attachment comes back from `GET /api/sessions/$SLUG` as
`kind: "file"` with a `file` object. Download it and look at it:

```bash
curl -s -H "Authorization: Bearer $TOKEN" -o /tmp/shot.png "$FILE_URL"
```

Then read the saved file. The cap is 10 MB per image.

## Who said what

Replies come back tagged. `author` is `auto` for the agent, `admin` for the signed-in
owner, and `guest` for anyone who joined with the code (the usual case on a target
machine). Your own posts are `claude`. Any human or agent reply releases a
`wait` call.

## Privacy

Everything is stored in plain text on the box, and anyone holding the four-digit code
can read the thread. Output routinely contains usernames, email addresses, hostnames
and serial numbers.

- Never write a command that prints tokens, passwords, or key material.
- Prefer narrow queries over dumps: `Select-Object` the two fields you need rather
  than `*`.
- When a machine belongs to someone else, keep to what the problem requires.
- Sessions are purged after 30 days of inactivity, and an armed agent is disarmed
  after 60 minutes idle: but do not rely on either. Delete a session when the job is
  done, and `/autorun/stop` when you stop using it.

## Manual copy-paste (fallback: only when asked, or the agent cannot run)

If the user specifically wants to copy-paste, or the agent will not run on that
machine, drop back to the manual loop. It is the same session and endpoints; the
difference is that **a human** copies each command and pastes the output back.

**What the target page shows in this mode:** one panel with the command and a big
**Copy command** button (the command text is collapsed by default, and will usually
not be opened), a **paste box** underneath that **submits the moment it is pasted
into** (no button, no Enter), and a collapsed History button. So never put
instructions in the command body, because they will not be read: say anything that
needs saying in the Claude Code session instead, and make every command safe to run
blind.

**Post a command as text/plain, then wait.** `tempshell-run.sh` works here too (it just
waits for a human paste instead of the agent's post). Or post and wait separately:

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: text/plain' \
  --data-binary 'Get-ChildItem "C:\Program Files" | Select-Object Name' \
  "$BASE/api/sessions/$SLUG/command?lang=powershell"
bash ~/.claude/skills/tempshell-session/tempshell-wait.sh $SLUG $LAST_SEQ
```

`tempshell-wait.sh` blocks until a reply arrives and prints `{timed_out, seq, entries}`.
`$LAST_SEQ` is the highest `seq` you have already seen: the seq returned when you
posted counts as seen, so pass that; `0` the first time. Run the waiter in the
background; do not poll `/wait` by hand.

**One line per command on the manual path.** A multi-line command pasted into a
console runs line by line, so a block breaks apart: `if ($x) { 'yes' }` then `else
{ 'no' }` fails with `The term 'else' is not recognized`. Keep every command to one
line and chain with `;`:

| Instead of | Use |
|---|---|
| multi-line `if/else` | `if ($x) { 'yes' } else { 'no' }` |
| `foreach (...) { }` | `... \| ForEach-Object { }` on one line |
| `try/catch` block | `-ErrorAction SilentlyContinue`, or `2>$null` |
| several statements | join with `;` |

`kind` and `lang` go in the query string (`?kind=note` for something not meant to be
run). The `command` response includes `autorun`: `manual`, `armed`, or
`waiting-to-arm`.

## Other endpoints

| | |
|---|---|
| `GET /api/sessions` | All sessions, each with a `pending` count |
| `GET /api/sessions/$SLUG` | The whole thread (add `?compact=1` to drop duplicated bodies) |
| `DELETE /api/sessions/$SLUG` | Remove a session and its history |
| `GET` / `PUT /api/quick` | The quick paste box on the tempshell home page |

`quick` is right for moving a string between your own devices without a session: a
path, a connection string, a URL to open on a phone. It syncs live to
every device with the page open.
