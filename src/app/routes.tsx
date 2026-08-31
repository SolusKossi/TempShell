import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { config } from '../config.ts';
import { bus } from '../bus.ts';
import {
  clientIp,
  grantJoin,
  grantSession,
  hasJoined,
  joinBudgetAvailable,
  rateLimit,
  recordWrongGuess,
  revokeSession,
} from '../auth.ts';
import { apiUserId, currentUserId, isOwner } from '../identity.ts';
import * as users from '../users.ts';
import * as store from './store.ts';
import { AccountsPage, HomePage, JoinPage, LoginPage, SessionPage, type SessionView, activityFeed, historyLabel, runPanel, sessionList, threadHtml, topSection } from './views.tsx';

/** The live status an auto session's page shows: connected?, busy?, what target. */
function sessionView(session: store.Session): SessionView {
  const ex = store.getExecutor(session.id);
  return {
    status: store.sessionStatus(session),
    busy: store.runningSince(session.id) != null,
    runningSeq: store.runningCommandSeq(session.id),
    target: ex?.host ? { host: ex.host, ps_version: ex.ps_version, elevated: Boolean(ex.elevated) } : null,
  };
}

export const app = new Hono();

/** A logged-in user can see their own sessions; a guest needs the join code. */
function canAccess(c: Context, session: store.Session): boolean {
  return currentUserId(c) === session.owner || hasJoined(c, session.id);
}

/** Parse a JSON body, returning null instead of throwing on malformed input. */
async function safeJson<T>(c: Context): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

/** Parse JSON text, keeping the parser's own error message (which names the position). */
function safeParse<T>(raw: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* ------------------------------------------------------------ web: auth --- */

app.get('/login', (c) => (isOwner(c) ? c.redirect('/') : c.html(LoginPage())));

app.post('/login', async (c) => {
  if (!rateLimit(`login:${clientIp(c)}`, 8, 300_000)) {
    return c.html(LoginPage('Too many attempts. Wait five minutes.'), 429);
  }
  const form = await c.req.parseBody();
  const username = String(form.username ?? '');
  const password = String(form.password ?? '');
  const uid = users.login(username, password);
  if (!uid) return c.html(LoginPage('Wrong username or password.'), 401);
  grantSession(c, uid);
  return c.redirect('/');
});

app.get('/logout', (c) => {
  revokeSession(c);
  return c.redirect('/login');
});

/* --------------------------------------------------------- web: accounts --- */

function requireOwner(c: Context): string | null {
  const uid = currentUserId(c);
  return uid && users.isOwnerId(uid) ? uid : null;
}

app.get('/accounts', (c) => {
  if (!requireOwner(c)) return c.redirect('/');
  return c.html(AccountsPage(users.listUsers()));
});

app.post('/accounts', async (c) => {
  if (!requireOwner(c)) return c.redirect('/');
  const form = await c.req.parseBody();
  try {
    const created = users.createUser(String(form.username ?? ''), String(form.password ?? ''));
    return c.html(AccountsPage(users.listUsers(), { username: created.username, token: created.token }));
  } catch (error) {
    return c.html(AccountsPage(users.listUsers(), undefined, String((error as Error).message)), 400);
  }
});

app.post('/accounts/:id/token', (c) => {
  if (!requireOwner(c)) return c.redirect('/');
  const id = c.req.param('id');
  const user = users.byId(id);
  if (!user || user.role === 'owner') return c.redirect('/accounts');
  const token = users.resetToken(id);
  return c.html(AccountsPage(users.listUsers(), { username: user.username, token }));
});

app.post('/accounts/:id/delete', (c) => {
  if (!requireOwner(c)) return c.redirect('/');
  const id = c.req.param('id');
  if (!users.isOwnerId(id)) {
    // Remove everything the member owned first, then the account itself.
    store.deleteOwner(id);
    try {
      users.deleteUser(id);
    } catch {
      // owner guard in users.deleteUser; ignore
    }
  }
  return c.redirect('/accounts');
});

app.get('/join', (c) => c.html(JoinPage()));

app.post('/join', async (c) => {
  // Four digits is only 9000 options, so guessing is limited per IP and globally.
  if (!rateLimit(`join:${clientIp(c)}`, 6, 900_000) || !joinBudgetAvailable()) {
    return c.html(JoinPage('Too many attempts. Try again later.'), 429);
  }
  const form = await c.req.parseBody();
  const code = String(form.code ?? '').trim();
  const session = store.getSessionByCode(code);
  if (!session) {
    recordWrongGuess();
    return c.html(JoinPage('No session with that code.'), 404);
  }
  grantJoin(c, session.id);
  return c.redirect(`/s/${session.slug}`);
});

/* ------------------------------------------------------------ web: home --- */

// Joining is the common case: most visits come from a machine that is not
// yours, so the code box is the landing page rather than a login form.
app.get('/', (c) => {
  const uid = currentUserId(c);
  if (!uid) return c.html(JoinPage());
  const sessions = store.listSessions(uid).map((s) => ({ ...s, pending: store.pendingCommands(s.id), status: store.sessionStatus(s) }));
  return c.html(HomePage(store.getQuick(uid).body, sessions, users.isOwnerId(uid)));
});

app.get('/sessions/list', (c) => {
  const uid = currentUserId(c);
  if (!uid) return c.text('', 403);
  const sessions = store.listSessions(uid).map((s) => ({ ...s, pending: store.pendingCommands(s.id), status: store.sessionStatus(s) }));
  return c.html(sessionList(sessions));
});

app.post('/sessions', async (c) => {
  const uid = currentUserId(c);
  if (!uid) return c.redirect('/login');
  const form = await c.req.parseBody();
  const session = store.createSession(String(form.title ?? ''), uid);
  return c.redirect(`/s/${session.slug}`);
});

app.get('/quick', (c) => {
  const uid = currentUserId(c);
  if (!uid) return c.json({ error: 'unauthorised' }, 403);
  return c.json(store.getQuick(uid));
});

app.post('/quick', async (c) => {
  const uid = currentUserId(c);
  if (!uid) return c.json({ error: 'unauthorised' }, 403);
  const { body } = await c.req.json<{ body?: string }>();
  store.setQuick(uid, String(body ?? '').slice(0, 500_000));
  return c.json({ ok: true });
});

app.get('/stream', (c) => {
  const uid = currentUserId(c);
  if (!uid) return c.text('', 403);
  return streamSSE(c, async (stream) => {
    const send = (event: string) => stream.writeSSE({ event, data: String(Date.now()) });
    // Quick paste sync is per-user; session-list changes are global but harmless
    // to hear (the list endpoint re-scopes to this user anyway).
    const offQuick = bus.subscribe(`quick:${uid}`, () => void send('quick'));
    const offSessions = bus.subscribe('sessions', () => void send('sessions'));
    try {
      while (!c.req.raw.signal.aborted) {
        await stream.sleep(25_000);
        await stream.writeSSE({ event: 'ping', data: '1' });
      }
    } finally {
      offQuick();
      offSessions();
    }
  });
});

/* --------------------------------------------------------- web: session --- */

app.get('/s/:slug', (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.notFound();
  if (!canAccess(c, session)) return c.redirect('/join');
  return c.html(
    SessionPage(session, store.listEntries(session.id), currentUserId(c) === session.owner, sessionView(session)),
  );
});

app.get('/s/:slug/thread', (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.notFound();
  if (!canAccess(c, session)) return c.text('', 403);
  return c.html(threadHtml(store.listEntries(session.id)));
});

// Read-only activity log for an auto session's page (refreshed live).
app.get('/s/:slug/activity', (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.notFound();
  if (!canAccess(c, session)) return c.text('', 403);
  return c.html(activityFeed(store.listEntries(session.id), sessionView(session)));
});

// The whole top of the page (status + setup), so it restructures as the agent
// connects or drops.
app.get('/s/:slug/status', (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.notFound();
  if (!canAccess(c, session)) return c.text('', 403);
  return c.html(topSection(session, sessionView(session), store.listEntries(session.id)));
});

/**
 * Approve or deny a held command. Anyone in the session can decide : it is their
 * machine. A denial writes a result so whoever is waiting on that command gets
 * an answer instead of blocking until the timeout.
 */
function decide(c: Context, approve: boolean) {
  // Standalone helper, so the params are not route-narrowed for us.
  const session = store.getSession(c.req.param('slug') ?? '');
  if (!session) return c.notFound();
  if (!canAccess(c, session)) return c.redirect('/join');
  const seq = Number(c.req.param('seq'));
  const who = currentUserId(c) === session.owner ? 'admin' : 'guest';
  const entry = Number.isFinite(seq) ? store.decideCommand(session.id, seq, approve, who) : null;
  if (entry && !approve) {
    store.addResult(session.id, {
      stdout: '',
      stderr: 'Denied at the machine. The command was not run.',
      exitCode: null,
      durationMs: null,
      truncated: false,
      status: 'denied',
      hadErrors: true,
      replyTo: seq,
      errorsJson: null,
    });
  }
  return c.redirect(`/s/${session.slug}`);
}

app.post('/s/:slug/approve/:seq', (c) => decide(c, true));
app.post('/s/:slug/deny/:seq', (c) => decide(c, false));

// Anyone in the session (the owner, or the person at the machine who joined) can
// stop auto-run : it is their machine the agent is running on.
app.post('/s/:slug/autorun-stop', (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.notFound();
  if (!canAccess(c, session)) return c.redirect('/join');
  store.haltAuto(session.id);
  return c.redirect(`/s/${session.slug}`);
});

/** Everything the page needs to re-render, so the history stays open if it was. */
app.get('/s/:slug/live', (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.json({ error: 'not found' }, 404);
  if (!canAccess(c, session)) return c.json({ error: 'unauthorised' }, 403);
  const entries = store.listEntries(session.id);
  return c.json({ run: runPanel(entries), thread: threadHtml(entries), label: historyLabel(entries) });
});

app.post('/s/:slug/reply', async (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.notFound();
  if (!canAccess(c, session)) return c.json({ error: 'unauthorised' }, 403);
  const { body } = await c.req.json<{ body?: string }>();
  const text = String(body ?? '');
  if (!text.trim()) return c.json({ error: 'empty' }, 400);
  // Signed in is 'admin'; anyone here via a join code is 'guest'.
  const author = currentUserId(c) === session.owner ? 'admin' : 'guest';
  const entry = store.addEntry(session.id, author, 'output', text.slice(0, 1_000_000));
  return c.json({ ok: true, seq: entry.seq });
});

/** Pasted screenshots. The client sends the clipboard's image as multipart. */
app.post('/s/:slug/upload', async (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.notFound();
  if (!canAccess(c, session)) return c.json({ error: 'unauthorised' }, 403);

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) return c.json({ error: 'no file' }, 400);
  if (file.size === 0) return c.json({ error: 'empty' }, 400);
  if (file.size > config.maxUploadBytes) {
    return c.json({ error: `too large, max ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB` }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = store.saveFile(session.id, file.name, file.type || 'application/octet-stream', bytes);
  const author = currentUserId(c) === session.owner ? 'admin' : 'guest';
  const entry = store.addEntry(session.id, author, 'file', stored.name, null, stored.id);
  return c.json({ ok: true, seq: entry.seq, id: stored.id });
});

app.get('/s/:slug/f/:id', (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.notFound();
  if (!canAccess(c, session)) return c.text('', 403);
  const file = store.getFile(c.req.param('id'));
  // Scoped to the session, so a join code cannot reach another session's files.
  if (!file || file.session_id !== session.id) return c.notFound();
  return serveFile(c, file);
});

app.post('/s/:slug/delete', (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session || currentUserId(c) !== session.owner) return c.redirect('/');
  store.deleteSession(session.id);
  return c.redirect('/');
});

app.get('/s/:slug/stream', (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.notFound();
  if (!canAccess(c, session)) return c.text('', 403);
  return streamSSE(c, async (stream) => {
    const off = bus.subscribe(`session:${session.id}`, () => {
      void stream.writeSSE({ event: 'update', data: String(Date.now()) });
    });
    try {
      while (!c.req.raw.signal.aborted) {
        await stream.sleep(25_000);
        await stream.writeSSE({ event: 'ping', data: '1' });
      }
    } finally {
      off();
    }
  });
});

/* -------------------------------------------------------------- api --- */

const api = new Hono<{ Variables: { uid: string } }>();

// Resolve the bearer token to a user once, and hang it on the context. Every
// session the API touches must belong to this user.
api.use('*', async (c, next) => {
  const uid = apiUserId(c);
  if (!uid) return c.json({ error: 'unauthorised' }, 401);
  c.set('uid', uid);
  await next();
});

/** The named session, but only if it belongs to the calling user. */
function ownedSession(c: Context, uid: string) {
  const session = store.getSession(c.req.param('slug') ?? '');
  return session && session.owner === uid ? session : null;
}

api.get('/sessions', (c) =>
  c.json({
    sessions: store.listSessions(c.get('uid'), true).map((s) => ({
      slug: s.slug,
      title: s.title,
      code: s.code,
      closed: Boolean(s.closed),
      updated_at: s.updated_at,
      url: `${config.publicUrl}/s/${s.slug}`,
      pending: store.pendingCommands(s.id),
    })),
  }),
);

api.post('/sessions', async (c) => {
  const { title } = await c.req.json<{ title?: string }>();
  const session = store.createSession(String(title ?? 'Troubleshooting session'), c.get('uid'));
  return c.json(
    {
      slug: session.slug,
      title: session.title,
      code: session.code,
      url: `${config.publicUrl}/s/${session.slug}`,
      join_url: `${config.publicUrl}/join`,
    },
    201,
  );
});

api.get('/sessions/:slug', (c) => {
  const session = ownedSession(c, c.get('uid'));
  if (!session) return c.json({ error: 'not found' }, 404);
  const compact = c.req.query('compact') === '1' || c.req.query('fields') === 'result';
  return c.json({
    slug: session.slug,
    title: session.title,
    code: session.code,
    url: `${config.publicUrl}/s/${session.slug}`,
    entries: store.listEntries(session.id).map((e) => toApiEntry(e, compact)),
  });
});

api.post('/sessions/:slug/command', async (c) => {
  const session = ownedSession(c, c.get('uid'));
  if (!session) return c.json({ error: 'not found' }, 404);

  // Three ways in, so a Windows command full of backslashes never has to survive
  // JSON escaping: raw text/plain (whole body is the command), a base64 body_b64
  // field, or plain JSON body. Escaping is the single thing that trips callers.
  const ctype = c.req.header('content-type') ?? '';
  let text: string;
  let lang: string | null = c.req.query('lang') ?? 'powershell';
  let kind = c.req.query('kind') ?? 'command';
  // The action log. Query params work with a text/plain body, so the command
  // itself still needs no escaping.
  let intent: string | null = c.req.query('intent') ?? null;
  let why: string | null = c.req.query('why') ?? null;
  let risk: string | null = c.req.query('risk') ?? null;

  if (ctype.startsWith('text/plain')) {
    // Decode the raw body as UTF-8 explicitly. A Norwegian path (C:\Users\Bjørn),
    // a folder under Årsoppgjør, an æ/ø/å service name must survive verbatim; a
    // wrong default codepage would silently corrupt the command before it runs.
    text = Buffer.from(await c.req.arrayBuffer()).toString('utf8');
  } else {
    const raw = await c.req.raw.clone().text();
    const parsed = safeParse<{
      body?: string;
      body_b64?: string;
      lang?: string;
      kind?: string;
      intent?: string;
      why?: string;
      risk?: string;
    }>(raw);
    if (!parsed.ok) {
      return c.json({ error: 'invalid JSON body', detail: parsed.error, hint: 'send Content-Type: text/plain with the raw command instead, or use body_b64' }, 400);
    }
    const p = parsed.value;
    text = p.body_b64 ? Buffer.from(p.body_b64, 'base64').toString('utf8') : String(p.body ?? '');
    if (p.lang !== undefined) lang = p.lang;
    if (p.kind !== undefined) kind = p.kind;
    if (p.intent !== undefined) intent = p.intent;
    if (p.why !== undefined) why = p.why;
    if (p.risk !== undefined) risk = p.risk;
  }

  if (!text.trim()) return c.json({ error: 'body required' }, 400);
  // A note is prose, not code, so it carries no language unless one was asked for.
  const isNote = kind === 'note';
  const entryLang = isNote && c.req.query('lang') == null ? null : lang;
  const entry = store.addEntry(session.id, 'claude', isNote ? 'note' : 'command', text.slice(0, 200_000), entryLang, null, {
    intent,
    why,
    risk,
  });

  // Tell the caller which loop it is in: will this run by itself, or wait for a human?
  const ex = store.getExecutor(session.id);
  const autorun = session.auto_enabled ? (ex?.armed && !ex.stop ? 'armed' : 'waiting-to-arm') : 'manual';
  return c.json(
    {
      ok: true,
      seq: entry.seq,
      autorun,
      // 'pending' means a human at the machine must approve before it runs.
      approval: entry.approval ?? null,
      url: `${config.publicUrl}/s/${session.slug}`,
    },
    201,
  );
});

/**
 * Long poll. Holds the connection until the human pastes something back, so the
 * caller can simply await a reply instead of polling in a loop.
 */
api.get('/sessions/:slug/wait', async (c) => {
  const session = ownedSession(c, c.get('uid'));
  if (!session) return c.json({ error: 'not found' }, 404);

  const since = Number(c.req.query('since') ?? 0);
  const timeoutMs = Math.min(Number(c.req.query('timeout') ?? 60), 300) * 1000;
  const deadline = Date.now() + timeoutMs;

  const replies = () => store.listEntries(session.id, since).filter((e) => e.author !== 'claude');

  let found = replies();
  while (found.length === 0 && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await bus.wait(`reply:${session.id}`, remaining, c.req.raw.signal);
    if (c.req.raw.signal.aborted) break;
    found = replies();
  }

  const compact = c.req.query('compact') === '1' || c.req.query('fields') === 'result';
  return c.json({
    timed_out: found.length === 0,
    seq: store.latestSeq(session.id),
    entries: found.map((e) => toApiEntry(e, compact)),
  });
});

api.delete('/sessions/:slug', (c) => {
  const session = ownedSession(c, c.get('uid'));
  if (!session) return c.json({ error: 'not found' }, 404);
  store.deleteSession(session.id);
  return c.json({ ok: true });
});

api.get('/files/:id', (c) => {
  const file = store.getFile(c.req.param('id'));
  if (!file) return c.json({ error: 'not found' }, 404);
  return serveFile(c, file);
});

api.get('/quick', (c) => c.json(store.getQuick(c.get('uid'))));

api.put('/quick', async (c) => {
  const { body } = await c.req.json<{ body?: string }>();
  store.setQuick(c.get('uid'), String(body ?? '').slice(0, 500_000));
  return c.json({ ok: true });
});

/* --- auto-run control (token-gated: only Claude and the owner) --- */

/**
 * Turn on auto-run and mint a single-use arming code. The code comes back only
 * here, to the API-token holder, so it reaches the person at the machine solely
 * by Claude relaying it : which is the whole security of the scheme.
 */
api.post('/sessions/:slug/autorun', (c) => {
  const session = ownedSession(c, c.get('uid'));
  if (!session) return c.json({ error: 'not found' }, 404);
  const armingCode = store.enableAuto(session.id);
  return c.json({
    ok: true,
    arming_code: armingCode,
    expires_in_seconds: 900,
    join_code: session.code,
    setup_url: `${config.publicUrl}/s/${session.slug}`,
    note: 'Give the join code and the arming code to the person at the machine. They open the session, copy the Auto-run snippet into an admin PowerShell, and enter the arming code when it asks.',
  });
});

api.get('/sessions/:slug/autorun', (c) => {
  const session = ownedSession(c, c.get('uid'));
  if (!session) return c.json({ error: 'not found' }, 404);
  const ex = store.getExecutor(session.id);
  const pending = store.pendingCommandSeqs(session.id);
  const runningSince = store.runningSince(session.id);
  // One coherent state, rather than armed and stopped both reading true.
  const state = !session.auto_enabled
    ? ex?.stop
      ? 'stopped'
      : 'off'
    : ex?.armed
      ? 'armed'
      : 'waiting-to-arm';
  return c.json({
    state,
    enabled: Boolean(session.auto_enabled),
    armed: Boolean(ex?.armed) && !ex?.stop,
    stopped: Boolean(ex?.stop),
    last_seen: ex?.last_seen ?? null,
    // last_seen freezes while a command runs; `busy` says the agent is executing,
    // so a stale last_seen with busy:true is working, not dead.
    busy: runningSince != null,
    running_since: runningSince,
    pending_command_seqs: pending,
    // Commands held for a human decision. While one sits here the agent is
    // deliberately idle : it is not stuck.
    awaiting_approval: store.pendingApprovals(session.id).map((e) => ({
      seq: e.seq,
      intent: e.intent ?? null,
      why: e.why ?? null,
      body: e.body,
    })),
    // What the agent reported it actually is, so you can shape commands for it.
    target: ex?.host
      ? { host: ex.host, ps_version: ex.ps_version, elevated: Boolean(ex.elevated) }
      : null,
  });
});

/**
 * Report the task finished. Without this a completed run looked like a failure:
 * the page only knew the agent had gone away, not that the work was done.
 */
api.post('/sessions/:slug/complete', async (c) => {
  const session = ownedSession(c, c.get('uid'));
  if (!session) return c.json({ error: 'not found' }, 404);
  const body = await safeJson<{ note?: string; outcome?: string }>(c);
  const note = body?.note ? store.plainText(String(body.note)).slice(0, 400) : null;
  const outcome = body?.outcome === 'stopped' ? null : 'done';
  store.setOutcome(session.id, outcome, note);
  return c.json({ ok: true, outcome, note });
});

api.post('/sessions/:slug/autorun/stop', (c) => {
  const session = ownedSession(c, c.get('uid'));
  if (!session) return c.json({ error: 'not found' }, 404);
  store.haltAuto(session.id);
  return c.json({ ok: true });
});

app.route('/api', api);

/* ----------------------------------------------------- executor (agent) --- */

/**
 * These endpoints are called by the PowerShell agent on the target machine, not
 * by Claude. They authenticate with the executor token issued at arming, never
 * with the API token, so a leaked API token cannot drive a machine and a leaked
 * executor token is scoped to one session and revocable.
 */

function executorAuth(c: Context, session: store.Session): store.Executor | null {
  const header = c.req.header('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  return store.executorBySession(session.id, header.slice(7));
}

// Arming: swap the code for a token. Rate limited hard because the code is short.
app.post('/x/:slug/arm', async (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session || !session.auto_enabled) return c.json({ error: 'not available' }, 404);
  if (!rateLimit(`arm:${clientIp(c)}:${session.id}`, 5, 600_000) || !joinBudgetAvailable()) {
    return c.json({ error: 'too many attempts' }, 429);
  }
  const parsed = await safeJson<{ code?: string; host?: string; user?: string; ps?: string; elevated?: boolean }>(c);
  if (!parsed) return c.json({ error: 'invalid JSON body' }, 400);
  const token = store.armExecutor(session.id, String(parsed.code ?? '').trim(), {
    host: parsed.host,
    user: parsed.user,
    psVersion: parsed.ps,
    elevated: parsed.elevated,
  });
  if (!token) {
    recordWrongGuess();
    return c.json({ error: 'wrong or expired arming code' }, 401);
  }
  return c.json({ ok: true, token });
});

// Long-poll for the next command to run, or a stop signal. The command is
// claimed on the server so it is served exactly once, and never inferred done.
app.get('/x/:slug/poll', async (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.json({ error: 'not found' }, 404);
  const ex = executorAuth(c, session);
  if (!ex) return c.json({ error: 'unauthorised' }, 401);
  if (ex.stop) return c.json({ stop: true });

  const timeoutMs = Math.min(Number(c.req.query('timeout') ?? 60), 90) * 1000;
  const deadline = Date.now() + timeoutMs;

  let cmd = store.claimNextCommand(session.id);
  while (!cmd && Date.now() < deadline) {
    if (store.getExecutor(session.id)?.stop) return c.json({ stop: true });
    await bus.wait(`session:${session.id}`, deadline - Date.now(), c.req.raw.signal);
    if (c.req.raw.signal.aborted) break;
    cmd = store.claimNextCommand(session.id);
  }
  if (!cmd) return c.json({ timed_out: true });
  return c.json({ seq: cmd.seq, body: cmd.body, lang: cmd.lang });
});

// Post a command's result back; mark that command done so it is never re-served.
// Accepts the structured shape from the agent, and the old {output} for safety.
app.post('/x/:slug/result', async (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session) return c.json({ error: 'not found' }, 404);
  const ex = executorAuth(c, session);
  if (!ex) return c.json({ error: 'unauthorised' }, 401);
  const parsed = await safeJson<{
    seq?: number;
    output?: string;
    stdout?: string;
    stderr?: string;
    exit_code?: number | null;
    duration_ms?: number | null;
    truncated?: boolean;
    status?: string;
    had_errors?: boolean;
    errors?: unknown;
  }>(c);
  if (!parsed) return c.json({ error: 'invalid JSON body' }, 400);

  const seq = Number(parsed.seq ?? 0);
  if (seq > 0) store.markCommandDone(session.id, seq);
  // The structured error records are stored verbatim as JSON text. PowerShell's
  // ConvertTo-Json unwraps a single-element array into a bare object, so coerce
  // back to an array; always store one (empty if none) so a consumer can rely on
  // result.errors being present and use .length safely.
  const rawErrors = parsed.errors;
  const errorsArr = rawErrors == null ? [] : Array.isArray(rawErrors) ? rawErrors : [rawErrors];
  const errorsJson = JSON.stringify(errorsArr);
  store.addResult(session.id, {
    stdout: String(parsed.stdout ?? parsed.output ?? ''),
    stderr: String(parsed.stderr ?? ''),
    exitCode: parsed.exit_code == null ? null : Number(parsed.exit_code),
    durationMs: parsed.duration_ms == null ? null : Number(parsed.duration_ms),
    truncated: Boolean(parsed.truncated),
    status: parsed.status ?? 'ok',
    hadErrors: Boolean(parsed.had_errors),
    replyTo: seq > 0 ? seq : null,
    errorsJson,
  });
  return c.json({ ok: true, ran_seq: seq });
});

// The self-contained agent, filled in for this session. Served to the browser
// on the session page; never a download-and-execute one-liner.
app.get('/x/:slug/agent.ps1', (c) => {
  const session = store.getSession(c.req.param('slug'));
  if (!session || !session.auto_enabled) return c.text('auto-run is not enabled', 404);
  if (!canAccess(c, session)) return c.text('join the session first', 403);
  // Doubled single-quotes and no line breaks, so the title is safe inside the
  // agent's single-quoted PowerShell string literal.
  const safeTitle = session.title.replace(/'/g, "''").replace(/[\r\n]+/g, ' ').slice(0, 60);
  // Trailing newline: the console executes every newline-terminated line, so the
  // last one otherwise sits in the buffer waiting for Enter. This makes the paste
  // run on its own where the terminal honours it, and is harmless where bracketed
  // paste holds it back (you just press Enter as before).
  return c.text(agentScript(`${config.publicUrl}`, session.slug, safeTitle) + '\n', 200, {
    'content-type': 'text/plain; charset=utf-8',
  });
});

/* ------------------------------------------------------------- helpers --- */

/**
 * The auto-run agent, pasted into an admin PowerShell on the target machine.
 * Deliberately self-contained: no download-and-execute, so it does not trip
 * ASR's script rules and there is nothing fetched-then-run beyond the commands
 * the session itself carries. It arms with a code delivered by Claude, then
 * runs each command and posts the output back, until the owner stops it or
 * Ctrl+C.
 */
function agentScript(base: string, slug: string, title: string): string {
  // Rendered as a live terminal dashboard on the target machine. String.raw so
  // the figlet banner's backslashes survive; the PowerShell uses [char] code
  // points instead of backticks, so nothing here needs escaping but ${base},
  // ${slug} and ${title}, which interpolate.
  return String.raw`# tempshell auto-run agent  (pasted as one script block, so the console buffers the
# whole thing and runs it on a single Enter instead of line by line)
& {
$ErrorActionPreference = 'Continue'
$base  = '${base}'
$instance = $base -replace '^https?://', ''
$slug  = '${slug}'
$title = '${title}'
$CAP = 100000
$TIMEOUT = 120
$E = [char]27

# The console defaults to the OEM code page (CP850 on this fleet), which renders
# the rounded box corners and braille spinner as '?' and mangles non-ASCII output.
# Force UTF-8 so the dashboard draws and so aoae/oslash survive round trips.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { [Console]::InputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ANSI is used on Windows Terminal (the fleet's host) and PowerShell 7, which
# both process virtual-terminal sequences. Elsewhere we fall back to plain lines.
$fancy = $false
if ($env:WT_SESSION) { $fancy = $true } elseif ($PSVersionTable.PSVersion.Major -ge 7) { $fancy = $true }

# ---- ansi helpers ------------------------------------------------------------
function Put($s) { [Console]::Write($s) }
function At($r, $c) { return $E + '[' + $r + ';' + $c + 'H' }
function Col($n) { return $E + '[38;5;' + $n + 'm' }
$RST = $E + '[0m'
$EL  = $E + '[K'

$SP = @([char]0x280B,[char]0x2819,[char]0x2839,[char]0x2838,[char]0x283C,[char]0x2834,[char]0x2826,[char]0x2827,[char]0x2807,[char]0x280F)
$global:spin = 0

# Visible length: box math must ignore ANSI colour codes, or a coloured value
# (the loader) counts hundreds of escape chars and blows past the column width.
function VisLen([string]$s) { if ($null -eq $s) { return 0 } return ($s -replace ([char]27 + '\[[0-9;]*m'), '').Length }

function Clamp([string]$s, [int]$n) {
  if ($null -eq $s) { return '' }
  $s = ($s -replace '[\r\n\t]', ' ')
  if ((VisLen $s) -gt $n) { $s = ($s -replace ([char]27 + '\[[0-9;]*m'), ''); return $s.Substring(0, [Math]::Max(0, $n - 1)) + [char]0x2026 }
  return $s
}

# ---- target / state ----------------------------------------------------------
$hostName = $env:COMPUTERNAME
$userName = $env:USERNAME
$psv = $PSVersionTable.PSVersion.ToString()
$elevated = $false
try { $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch {}

$state = 'connecting'
$curCmd = '-'
$lastCmd = '-'
$lastLine = '-'
$lastCol = 240
$ranCount = 0
$startedAt = Get-Date
$phaseAt = Get-Date
$conn = 'connected'
$runStart = Get-Date

# ---- drawing -----------------------------------------------------------------
function Banner {
  $b = @(
    ' _                     _        _ _ ',
    '| |_ ___ _ __  _ __ __| |_  ___| | |',
    '|  _/ -_) ''  \| ''_ (_-< '' \/ -_) | |',
    ' \__\___|_|_|_| .__/__/_||_\___|_|_|',
    '              |_|                   '
  )
  $g = @(176, 170, 164, 127, 90)
  for ($i = 0; $i -lt $b.Count; $i++) {
    Put (At (2 + $i) 5)
    Put ((Col $g[$i]) + $b[$i] + $RST)
    if ($i -eq 1) { Put ((Col 240) + '   auto-run agent' + $RST) }
    if ($i -eq 2) { Put ((Col 15) + '   ' + $instance + $RST) }
    Put $EL
  }
}

function Width { $cols = 100; try { $cols = [Console]::WindowWidth } catch {}; if ($cols -lt 34) { $cols = 34 }; return [Math]::Min($cols - 6, 108) }

function BoxTop($row, $spc) {
  $W = Width
  $seg = 2 + 3 + 9 + 10
  $dash = $W - $seg - 1; if ($dash -lt 0) { $dash = 0 }
  Put (At $row 4)
  Put ((Col 90) + ([char]0x256D) + ([char]0x2500) + (Col 170) + ' ' + $spc + ' ' + (Col 15) + $instance + (Col 240) + ' auto-run ' + (Col 90) + (([string][char]0x2500) * $dash) + ([char]0x256E) + $RST + $EL)
}
function BoxRule($row) {
  $W = Width
  Put (At $row 4)
  Put ((Col 90) + ([char]0x251C) + (([string][char]0x2500) * ($W - 2)) + ([char]0x2524) + $RST + $EL)
}
function BoxBot($row) {
  $W = Width
  Put (At $row 4)
  Put ((Col 90) + ([char]0x2570) + (([string][char]0x2500) * ($W - 2)) + ([char]0x256F) + $RST + $EL)
}
function BoxRow($row, $label, $value, $vcol) {
  $W = Width
  $v = Clamp $value ($W - 12)
  Put (At $row 4)
  Put ((Col 90) + ([char]0x2502) + $RST + ' ' + (Col 244) + ('{0,-9}' -f $label) + $RST + (Col $vcol) + $v + $RST)
  $pad = $W - 12 - (VisLen $v); if ($pad -lt 0) { $pad = 0 }
  Put ((' ' * $pad) + (Col 90) + ([char]0x2502) + $RST + $EL)
}

function Loader($frame, $width) {
  $span = ($width * 2) - 2
  $pos = $frame % $span
  if ($pos -ge $width) { $pos = $span - $pos }
  $s = ''
  for ($i = 0; $i -lt $width; $i++) {
    $d = [Math]::Abs($i - $pos)
    if ($d -eq 0) { $s += (Col 213) + ([char]0x2588) } elseif ($d -eq 1) { $s += (Col 170) + ([char]0x2593) } elseif ($d -eq 2) { $s += (Col 127) + ([char]0x2592) } else { $s += (Col 53) + ([char]0x2591) }
  }
  return $s + $RST
}

function StatusText {
  switch ($state) {
    'connecting' { return @('connecting', 208) }
    'waiting'    { return @('waiting for a command', 40) }
    'running'    { return @('running', 220) }
    'sending'    { return @('sending result', 44) }
    'stopped'    { return @('stopped', 240) }
    default      { return @($state, 250) }
  }
}

$PT = 9
function Draw {
  if (-not $fancy) { return }
  $dot = $SP[$global:spin % $SP.Count]; $global:spin++
  $st = StatusText
  $adm = 'not admin'; if ($elevated) { $adm = 'admin' }
  BoxTop ($PT + 0) $dot
  BoxRow ($PT + 1) 'target' ("$hostName  $([char]0x00B7)  $userName  $([char]0x00B7)  PS $psv  $([char]0x00B7)  $adm") 15
  BoxRow ($PT + 2) 'session' $title 250
  BoxRule ($PT + 3)
  $stTxt = "$dot $($st[0])"; if ($state -eq 'stopped') { $stTxt = $st[0] }
  BoxRow ($PT + 4) 'status' $stTxt $st[1]
  $cc = 240; if ($state -eq 'running') { $cc = 220 }
  BoxRow ($PT + 5) 'command' $curCmd $cc
  if ($state -eq 'running') {
    $secs = ((Get-Date) - $runStart).TotalSeconds
    BoxRow ($PT + 6) 'working' ((Loader $global:spin 20) + ('  {0,4:0.0}s' -f $secs)) 170
  } else {
    BoxRow ($PT + 6) '' '' 240
  }
  BoxRule ($PT + 7)
  BoxRow ($PT + 8) 'last' $lastCmd 250
  BoxRow ($PT + 9) 'result' $lastLine $lastCol
  BoxRule ($PT + 10)
  $up = ((Get-Date) - $startedAt).TotalSeconds
  BoxRow ($PT + 11) 'stats' ("ran $ranCount   $([char]0x00B7)   up {0:0}s   $([char]0x00B7)   $conn" -f $up) 240
  BoxBot ($PT + 12)
  Put (At ($PT + 14) 4); Put ((Col 240) + 'Ctrl+C to stop' + $RST + $EL)
}

function Plain([string]$m, [int]$c) {
  if ($fancy) { return }
  $fg = 'Gray'
  if ($c -eq 40) { $fg = 'Green' } elseif ($c -eq 220) { $fg = 'Yellow' } elseif ($c -eq 196) { $fg = 'Red' } elseif ($c -eq 44) { $fg = 'Cyan' }
  Write-Host $m -ForegroundColor $fg
}

# Normalise a stream: drop CR (so CRLF and lone CR both become LF) and trim
# trailing whitespace, so stdout and stderr share one line-ending convention.
function NL([string]$s) { if ($null -eq $s) { return '' } return ($s -replace [char]13, '').TrimEnd() }

# Split an over-long stream head+tail: console output puts the exceptions and
# summaries at the END, so keep both ends and mark the gap.
function Trunc([string]$s) {
  if ($null -eq $s) { return @('', $false) }
  if ($s.Length -le $CAP) { return @($s, $false) }
  $head = 60000; $tail = 40000
  $dropped = $s.Length - $head - $tail
  $mark = [char]10 + '... [tempshell trimmed ' + $dropped + ' chars] ...' + [char]10
  return @(($s.Substring(0, $head) + $mark + $s.Substring($s.Length - $tail)), $true)
}

# Run one command in its own runspace, streaming output into a collection so a
# throw, a parse error or a timeout cannot swallow what was already produced.
# A command that does not finish normally never reports status 'ok'.
function Invoke-Cmd($cmd) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $ps = [PowerShell]::Create()
  # The sentinel runs only if the command reaches the end. PowerShell's exit keyword
  # silently stops the pipeline with no exception and no exit code, so a script
  # that exits early would otherwise report a clean, empty success.
  $null = $ps.AddScript('$OutputEncoding=[System.Text.Encoding]::UTF8; try{[Console]::OutputEncoding=[System.Text.Encoding]::UTF8}catch{}').AddStatement().AddScript($cmd + [char]10 + '$global:__clipReachedEnd = $true')
  $out = New-Object System.Management.Automation.PSDataCollection[psobject]
  $in  = New-Object System.Management.Automation.PSDataCollection[psobject]
  $in.Complete()
  $term = $null; $timedOut = $false
  try {
    $h = $ps.BeginInvoke($in, $out)
    while (-not $h.IsCompleted) {
      if ($sw.Elapsed.TotalSeconds -ge $TIMEOUT) { $ps.Stop(); $timedOut = $true; break }
      Draw; Start-Sleep -Milliseconds 110
    }
    if (-not $timedOut) { $ps.EndInvoke($h) }
  } catch { $term = $_ }
  $sw.Stop()

  $so = NL ($out | Out-String -Width 200)
  $info = @($ps.Streams.Information | ForEach-Object { $_.ToString() }) -join [char]10
  if ($info) { $info = NL $info; if ($so) { $so = $so + [char]10 + $info } else { $so = $info } }

  # Structured error records, from the error stream: message plus the fields a
  # caller needs to tell (say) access-denied from not-found without a re-run.
  # Line numbers are relative to the submitted command, and no agent-harness
  # frame is reported.
  $errRecords = @()
  foreach ($er in $ps.Streams.Error) {
    $ln = $null; if ($er.InvocationInfo -and $er.InvocationInfo.ScriptLineNumber -gt 0) { $ln = $er.InvocationInfo.ScriptLineNumber }
    $tg = $null; if ($null -ne $er.TargetObject) { $tg = [string]$er.TargetObject }
    $errRecords += [ordered]@{ message = (NL ([string]$er.Exception.Message)); fq_error_id = [string]$er.FullyQualifiedErrorId; category = [string]$er.CategoryInfo.Category; exception_type = [string]$er.Exception.GetType().FullName; target = $tg; script_line = $ln }
  }
  $errLines = @($ps.Streams.Error | ForEach-Object { [string]$_.Exception.Message })
  if ($term) {
    # -ErrorAction Stop wraps the real error in an ActionPreferenceStopException;
    # unwrap to the original record so category / target / id are the true cause,
    # not the wrapper (which is always NotSpecified / null).
    $rec = $term; $unwrapped = $false
    $scan = $term.Exception
    while ($scan) {
      if (($scan -is [System.Management.Automation.ActionPreferenceStopException]) -and $scan.ErrorRecord) { $rec = $scan.ErrorRecord; $unwrapped = $true; break }
      $scan = $scan.InnerException
    }
    $ex = $rec.Exception
    while ($ex.InnerException) { $ex = $ex.InnerException }
    # Only report a line number when we have a real command record; a bare throw
    # or a parse error would otherwise leak the agent's own line.
    $ln = $null
    if ($unwrapped -and $rec.InvocationInfo -and $rec.InvocationInfo.ScriptLineNumber -gt 0) { $ln = $rec.InvocationInfo.ScriptLineNumber }
    $tg = $null; if ($null -ne $rec.TargetObject) { $tg = [string]$rec.TargetObject }
    $errLines += [string]$ex.Message
    $errRecords += [ordered]@{ message = (NL ([string]$ex.Message)); fq_error_id = [string]$rec.FullyQualifiedErrorId; category = [string]$rec.CategoryInfo.Category; exception_type = [string]$ex.GetType().FullName; target = $tg; script_line = $ln }
  }
  foreach ($wn in $ps.Streams.Warning) { $errLines += 'WARNING: ' + [string]$wn.Message }
  foreach ($vb in $ps.Streams.Verbose) { $errLines += 'VERBOSE: ' + [string]$vb.Message }
  foreach ($db in $ps.Streams.Debug)   { $errLines += 'DEBUG: '   + [string]$db.Message }
  if ($timedOut) { $errLines += "Command exceeded $TIMEOUT seconds and was stopped." }
  $se = NL ($errLines -join [char]10)

  $lec = $null
  try { $lec = $ps.Runspace.SessionStateProxy.PSVariable.GetValue('LASTEXITCODE') } catch { }
  $reachedEnd = $false
  try { $reachedEnd = [bool]$ps.Runspace.SessionStateProxy.PSVariable.GetValue('__clipReachedEnd') } catch { }
  # No terminating error, not a timeout, yet the end was never reached: the
  # script called exit. The code itself cannot be recovered from a runspace, so
  # say so rather than reporting success.
  # Only a genuine early exit: nothing threw, nothing timed out, AND nothing was
  # written to the error stream. A parse error also never reaches the sentinel,
  # but it reports itself through the error stream, so it must not be described
  # as an exit call.
  $exitedEarly = ((-not $reachedEnd) -and (-not $term) -and (-not $timedOut) -and ($errRecords.Count -eq 0))
  if ($exitedEarly) { $errLines += 'Script called exit before completing. PowerShell does not surface the exit code through the agent, so it is reported as a failure without a code.'; $se = NL ($errLines -join [char]10) }
  # Deliberately NOT $ps.HadErrors: that is true even when the script caught or
  # suppressed the error itself (try/catch, -ErrorAction SilentlyContinue), which
  # would report every defensive command as a failure. Judge on evidence that
  # actually survived: an unhandled terminating error, records left on the error
  # stream, a timeout, an early exit, or a native process exiting non-zero.
  $nativeFail = (($null -ne $lec) -and ([int]$lec -ne 0))
  # A native tool can fail with nothing on the error stream, which left errors[]
  # empty and no clue why the command failed. Record the exit itself.
  if ($nativeFail -and ($errRecords.Count -eq 0)) {
    $errRecords += [ordered]@{ message = ('A native command exited with code ' + [int]$lec + '.'); fq_error_id = 'NativeExitCode'; category = 'NotSpecified'; exception_type = ''; target = $null; script_line = $null }
  }
  $hadErr = ([bool]$term) -or ($errRecords.Count -gt 0) -or $timedOut -or $exitedEarly -or $nativeFail
  if ($timedOut) { $status = 'timeout' } elseif ($hadErr) { $status = 'error' } else { $status = 'ok' }
  try { $ps.Dispose() } catch { }

  return @{ stdout = "$so"; stderr = "$se"; exit_code = $(if ($null -ne $lec) { [int]$lec } else { $null }); status = $status; had = $hadErr; ms = $sw.ElapsedMilliseconds; errors = $errRecords }
}

# ---- arm (on a clean alternate screen when fancy) ----------------------------
if ($fancy) { Put ($E + '[?1049h'); Put ($E + '[2J'); Put ($E + '[H'); Banner; Put (At 9 5) }
$pin = Read-Host '   Arming code from Claude'

$armBody = @{ code = $pin; host = $hostName; user = $userName; ps = $psv; elevated = $elevated } | ConvertTo-Json
try {
  $armed = Invoke-RestMethod "$base/x/$slug/arm" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($armBody))
} catch {
  if ($fancy) { Put ($E + '[?1049l'); Put ($E + '[?25h') }
  Write-Host '   Arming failed - wrong or expired code.' -ForegroundColor Red
  return
}
$tok = $armed.token
$hdr = @{ Authorization = "Bearer $tok" }
$state = 'waiting'; $phaseAt = Get-Date
if ($fancy) { Put ($E + '[2J'); Put ($E + '[?25l'); Banner; Draw } else { Plain "Armed on $hostName as $userName (PS $psv, elevated $elevated). Ctrl+C to stop." 40 }

# ---- main loop ---------------------------------------------------------------
try {
  while ($true) {
    try {
      $wr = Invoke-WebRequest "$base/x/$slug/poll?timeout=2" -Headers $hdr -TimeoutSec 10 -UseBasicParsing
      $c = [System.Text.Encoding]::UTF8.GetString($wr.RawContentStream.ToArray()) | ConvertFrom-Json
      $conn = 'connected'
    } catch {
      if ($_.Exception.Response.StatusCode.value__ -eq 401) { $state = 'stopped'; $conn = 'ended'; Draw; Plain 'Auto-run ended.' 250; break }
      $conn = 'reconnecting'; $state = 'waiting'; Draw; Start-Sleep -Milliseconds 800; continue
    }
    if ($c.stop) { $state = 'stopped'; Draw; Plain 'Stopped by owner.' 220; break }
    if ($c.timed_out) { $state = 'waiting'; Draw; continue }

    $curCmd = "$($c.body)"
    $state = 'running'; $runStart = Get-Date
    Plain ("> " + $c.body) 44
    $r = Invoke-Cmd $c.body

    $to = Trunc $r.stdout; $te = Trunc $r.stderr
    $out = $to[0]; $err = $te[0]; $truncated = ($to[1] -or $te[1])

    $state = 'sending'; Draw
    $body = @{ seq = $c.seq; stdout = $out; stderr = $err; exit_code = $r.exit_code; duration_ms = $r.ms; status = $r.status; truncated = $truncated; had_errors = $r.had; errors = $r.errors } | ConvertTo-Json -Depth 5
    for ($try = 0; $try -lt 4; $try++) {
      try { Invoke-RestMethod "$base/x/$slug/result" -Method Post -Headers $hdr -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) | Out-Null; break } catch { Start-Sleep -Seconds 2 }
    }

    $ranCount++
    $lastCmd = $curCmd; $curCmd = '-'
    if ($r.status -eq 'timeout') { $lastLine = 'timed out'; $lastCol = 196 } elseif ($r.had) { $lastLine = ("errors  ({0:0.0}s)" -f ($r.ms / 1000)); $lastCol = 196 } else { $lastLine = ('ok  ({0:0.0}s)' -f ($r.ms / 1000)); $lastCol = 40 }
    Plain ("  " + $lastLine) $lastCol
    $state = 'waiting'; $phaseAt = Get-Date
    Draw
  }
} finally {
  if ($fancy) { Put ($E + '[?25h'); Put ($E + '[?1049l') }
}
}`;
}

function serveFile(c: Context, file: store.StoredFile) {
  let bytes: Buffer;
  try {
    bytes = readFileSync(store.filePath(file.id));
  } catch {
    return c.text('file missing on disk', 410);
  }
  return c.body(new Uint8Array(bytes), 200, {
    'content-type': file.mime,
    'content-length': String(file.size),
    // inline so images render; the filename still applies if you save it
    'content-disposition': `inline; filename="${file.name.replace(/["\\]/g, '')}"`,
    'cache-control': 'private, max-age=86400',
    'x-content-type-options': 'nosniff',
  });
}

/** Errors were stored as JSON text the agent posted; parse defensively. */
function safeErrors(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function toApiEntry(e: store.Entry, compact = false) {
  const file = e.file_id ? store.getFile(e.file_id) : null;
  const hasResult = e.run_status != null || e.stderr != null;
  return {
    seq: e.seq,
    author: e.author,
    kind: e.kind,
    // In compact mode the flattened body is dropped when a structured result is
    // present, since body is just stdout+stderr concatenated : halves the bytes
    // on a long output.
    ...(compact && hasResult ? {} : { body: e.body }),
    lang: e.lang,
    created_at: e.created_at,
    ...(e.reply_to != null ? { in_reply_to: e.reply_to } : {}),
    // The action log: what this step does, why, and whether a human had to allow it.
    ...(e.intent ? { intent: e.intent } : {}),
    ...(e.why ? { why: e.why } : {}),
    ...(e.risk ? { risk: e.risk } : {}),
    ...(e.approval ? { approval: e.approval } : {}),
    ...(e.decided_at ? { approval_decided_at: e.decided_at } : {}),
    ...(e.decided_by ? { approval_decided_by: e.decided_by } : {}),
    ...(hasResult
      ? {
          result: {
            stdout: e.stdout ?? e.body,
            stderr: e.stderr ?? '',
            exit_code: e.exit_code ?? null,
            had_errors: Boolean(e.had_errors),
            duration_ms: e.duration_ms ?? null,
            truncated: Boolean(e.truncated),
            status: e.run_status ?? 'ok',
            // Structured error records (message, fq_error_id, category, type,
            // target, script_line) when the agent supplied them.
            ...(e.errors_json ? { errors: safeErrors(e.errors_json) } : {}),
          },
        }
      : {}),
    ...(file
      ? {
          file: {
            id: file.id,
            name: file.name,
            mime: file.mime,
            size: file.size,
            // Fetchable with the API token, so an image can be downloaded and viewed.
            url: `${config.publicUrl}/api/files/${file.id}`,
          },
        }
      : {}),
  };
}
