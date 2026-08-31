# Tempshell

Run commands on a Windows machine you have no shell on, by having someone there
paste one PowerShell snippet into a terminal. An AI assistant then drives it:
each command runs on the machine and the output comes back, one step at a time,
with a plain note on every action and a human gate in front of anything risky.

Good for troubleshooting a test PC, a colleague's laptop, or a locked-down work
machine, without RDP, an install, or reading commands down the phone.

> Source available, not open source. Free for any non-commercial use. See [License](#license).

<!--
  A short screen recording belongs here. It is the most useful thing on this page.
  GitHub renders an uploaded .mp4 as a player, so no GIF is needed: drag one into
  a comment or the README editor and paste the URL it gives you.
-->

## How you use it

1. Ask your assistant (Claude Code, or anything that can call an HTTP API) to
   start a Tempshell session. It creates the session and gives you two four-digit
   codes.
2. On the machine you want to reach, open the instance URL, type the **join
   code**, click **Copy agent**, and paste it into a PowerShell window. It asks
   for the **arming code**; give it the one the assistant showed you.
3. That is it. From then on the assistant runs the loop: post a command, it runs
   on the machine, the output comes back, repeat until the problem is solved. You
   watch it happen on the page and approve anything risky.

Nobody types commands by hand. The person at the machine pastes once and can walk
away; you talk to your assistant in plain language.

## What makes it different

- **Every step says what it does and why.** The page reads as a chain of intentions,
  not a wall of PowerShell, and it is a record you can read back afterwards.
- **Risky actions are held for a human.** Anything that changes the machine, a
  service restart, a delete, a registry write, waits until someone at the keyboard
  presses **Approve**. Read-only checks just run. Who approved, and when, is
  recorded, so a fast yes is provably a human.
- **You can read what it runs.** The agent is a plain script, not something fetched
  from elsewhere and executed. Publishing the source is the point.

It does not persist across a reboot and there is no fleet-wide view. If you need
those, you want an installed agent, not this. Tempshell is for the one-off: reach
a machine, fix the thing, done.

## Self-host

Node 24+ (for its built-in SQLite) or Docker, plus a domain pointed at the box.

```bash
git clone https://github.com/SolusKossi/TempShell.git
cd TempShell
cp .env.example .env
```

Fill in `.env`:

```bash
PUBLIC_URL=https://tempshell.example.com     # where the world reaches it; baked into the agent
OWNER_PASSWORD_HASH=$(node scripts/hash-password.mjs 'a good password')
COOKIE_SECRET=$(openssl rand -base64 48)
API_TOKEN=$(openssl rand -hex 32)
```

Run it with Docker (the example `compose.yaml` and `caddy/Caddyfile` give you TLS):

```bash
./scripts/deploy.sh
```

or without Docker: `npm install && npm run build && npm start`.

## Driving it with Claude Code

`skills/tempshell-session/` is a [Claude Code](https://claude.com/claude-code)
skill plus helper scripts, so Claude can run the whole loop as one instruction.

```bash
cp -r skills/tempshell-session ~/.claude/skills/
echo 'https://tempshell.example.com' > ~/.claude/tempshell-base
echo '<your API_TOKEN>'              > ~/.claude/tempshell-token
```

`SKILL.md` is also the full reference for the API and its behaviour: result
semantics, the approval gate, timeouts, truncation, and the Windows traps worth
knowing. The API is plain HTTP, so nothing here is Claude-specific.

## API

Every call is `Authorization: Bearer $API_TOKEN`.

| | |
|---|---|
| `POST /api/sessions` | create a session `{title}` -> `{slug, code, url}` |
| `POST /api/sessions/:slug/autorun` | returns the arming code |
| `POST /api/sessions/:slug/command` | post a command (text/plain body); `?intent=&why=&risk=risky` |
| `GET  /api/sessions/:slug/wait` | long-poll for the next reply |
| `GET  /api/sessions/:slug/autorun` | live status: connected, busy, awaiting approval |
| `POST /api/sessions/:slug/complete` | mark the task finished |

Full detail is in `SKILL.md`.

## License

Source available under [PolyForm Noncommercial 1.0.0](LICENSE) with a plain-language
preamble. Read it, run it, self-host it, modify it for any non-commercial purpose.
Selling it or running it as a commercial service is not permitted; ask if you want to.
