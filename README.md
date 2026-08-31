# Tempshell

Run diagnostic commands on a Windows machine you have no shell on — a test PC, a
colleague's laptop, a locked-down work machine — by having someone there paste one
PowerShell snippet into a terminal. After that, an AI (or you) drives it: each
command runs on the machine and the output comes back, one step at a time, with a
plain-language note on every action and a human gate in front of anything risky.

It is the lightweight cousin of a fleet agent. No install, no MDM, no service to
package. One paste, and the machine is reachable until the window is closed.

> **Status: source available, not open source.** Free for any non-commercial use.
> See [License](#license).

<!--
  A short screen recording belongs here — paste the agent, watch a diagnostic run,
  approve a risky step, done. It is the single most useful thing on this page.
  Drop a GIF in docs/ and link it:  ![demo](docs/demo.gif)
-->

## Why this instead of remote desktop or a script over the phone

- **You get a shell where you had none.** No RDP, no TeamViewer session to babysit,
  no reading commands down a phone line for someone to mistype.
- **Every step says what it is and why.** The page reads as a chain of intentions —
  "restart the time service, because it is stopped and that blocks enrolment" —
  not a wall of raw PowerShell. It is a record you can read back afterwards.
- **Risky actions are held for a human.** Anything that changes the machine —
  a service restart, a delete, a registry write — is withheld until someone at the
  keyboard presses **Approve**. Read-only checks just run. Who approved, and when,
  is recorded on the entry, so a fast yes is provably a human and not a bypass.
- **It is honest about what it runs.** The agent is a plain script you can read
  before trusting it. Nothing is fetched from somewhere unseen and executed.

It is deliberately worse than a real fleet agent at the things a fleet agent is for:
it does not persist across a reboot, there is no fleet-wide view, and it will not run
where the machine's policy forbids pasting a script into PowerShell. If you have
outgrown those limits you want an installed agent, not this.

## How it works

1. You create a session and turn on auto-run. The server hands you two four-digit
   codes: a **join code** and an **arming code**.
2. The person at the machine opens the site, enters the join code, clicks **Copy
   agent**, and pastes it into a PowerShell window. It asks for the arming code.
3. From then on, commands you post run on that machine and the output comes back.
   The agent draws a small live dashboard; the web page shows the same run log,
   with the approval buttons and a screenshot upload for GUI problems.

The whole thing is one small Node process backed by SQLite. It is meant to sit on a
cheap VPS behind a reverse proxy that terminates TLS.

## Self-host

You need Node 24+ (for its built-in SQLite) or Docker, and a domain pointed at the box.

```bash
git clone https://github.com/SolusKossi/TempShell.git
cd TempShell
cp .env.example .env
```

Fill in `.env`:

```bash
# the address the world reaches this instance at (baked into the pasted agent)
PUBLIC_URL=https://tempshell.example.com
OWNER_PASSWORD_HASH=$(node scripts/hash-password.mjs 'a good password')
COOKIE_SECRET=$(openssl rand -base64 48)
API_TOKEN=$(openssl rand -hex 32)
```

Run it with Docker (the example `compose.yaml` plus `caddy/Caddyfile` give you TLS):

```bash
./scripts/deploy.sh          # local: docker compose up --build
```

or without Docker:

```bash
npm install && npm run build && npm start
```

Point `PUBLIC_URL`'s domain at the box, put the `API_TOKEN` where your tooling can
read it (see the skill below), and open the site.

## Driving it with Claude Code

`skills/tempshell-session/` is the client half: a [Claude Code](https://claude.com/claude-code)
skill and its helper scripts, so Claude can create a session, hand over the codes,
run the loop, gate risky commands, and read the results — end to end.

```bash
cp -r skills/tempshell-session ~/.claude/skills/
echo 'https://tempshell.example.com' > ~/.claude/tempshell-base
echo '<your API_TOKEN>'              > ~/.claude/tempshell-token
```

`SKILL.md` is also the most complete description of the API and its behaviour:
result semantics, the approval gate, timeouts, truncation, and the Windows traps
worth knowing before running anything unattended. Nothing about it is Claude-specific
— it is a plain HTTP API — but the skill is what makes it one instruction instead of
twenty.

## The API, briefly

Every call is `Authorization: Bearer $API_TOKEN`.

| | |
|---|---|
| `POST /api/sessions` | create a session `{title}` → `{slug, code, url}` |
| `POST /api/sessions/:slug/autorun` | enable auto-run, returns the arming code |
| `POST /api/sessions/:slug/command` | post a command (text/plain body, no escaping); `?intent=&why=&risk=risky` |
| `GET  /api/sessions/:slug/wait` | long-poll for the next reply |
| `GET  /api/sessions/:slug/autorun` | live status: connected, busy, awaiting approval |
| `POST /api/sessions/:slug/complete` | mark the task finished |

Full detail is in `SKILL.md`.

## License

Source available, not open source: [PolyForm Noncommercial 1.0.0](LICENSE) with a
plain-language preamble. Read it, run it, self-host it, modify it for any
non-commercial purpose. Selling it or running it as a commercial service is not
permitted; if you want to, ask.

The source is published so the agent you paste into a machine can be read before you
trust it — which is the whole point of a tool like this.
