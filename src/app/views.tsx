import { html, raw } from 'hono/html';
import { AUTOGROW, LIVE_TIME, Layout, esc, timeAgo } from '../ui/layout.tsx';
import { AUTHOR_LABEL, type Entry, type Session, type SessionStatus } from './store.ts';

export type SessionRow = Session & { pending: number; status: SessionStatus };

const STATUS_LABEL: Record<SessionStatus, string> = {
  live: 'live',
  arming: 'arming',
  inactive: 'inactive',
  manual: 'manual',
};

/* ---------------------------------------------------------------- join --- */

/** The default landing page. Most visits are from a machine that is not yours. */
export function JoinPage(error?: string) {
  return Layout({
    title: 'tempshell',
    bare: true,
    script: JOIN_SCRIPT,
    children: html`
      <div class="lead">
        <div class="mark mark-lg"></div>
        <h1>Join a session</h1>
        <p>Enter the four digit code</p>
      </div>
      ${error ? html`<div class="flash error">${error}</div>` : ''}
      <form method="post" action="/join" id="joinForm" class="stack">
        <input type="tel" id="code" name="code" class="code-input" inputmode="numeric"
               pattern="[0-9]{4}" maxlength="4" autocomplete="off" autofocus>
        <button class="primary" type="submit" style="width:100%">Join</button>
      </form>
      <p class="small muted" style="text-align:center;margin-top:22px">
        <a href="/login">Sign in as admin</a>
      </p>
    `,
  });
}

/* --------------------------------------------------------------- login --- */

export function LoginPage(error?: string) {
  return Layout({
    title: 'tempshell',
    bare: true,
    children: html`
      <div class="lead">
        <div class="mark mark-lg"></div>
        <h1>Sign in</h1>
        <p>Stays signed in for 60 days</p>
      </div>
      ${error ? html`<div class="flash error">${error}</div>` : ''}
      <form method="post" action="/login" class="stack">
        <input type="text" name="username" class="sans" placeholder="Username"
               autocomplete="username" autocapitalize="none" autofocus>
        <input type="password" name="password" placeholder="Password"
               autocomplete="current-password">
        <button class="primary" type="submit" style="width:100%">Sign in</button>
      </form>
      <p class="small muted" style="text-align:center;margin-top:22px">
        <a href="/join">Join with a code instead</a>
      </p>
    `,
  });
}

/* ---------------------------------------------------------------- home --- */

export function HomePage(quick: string, sessions: SessionRow[], isOwnerUser: boolean) {
  return Layout({
    title: 'tempshell',
    nav: [
      ...(isOwnerUser ? [{ href: '/accounts', label: 'Accounts' }] : []),
      { href: '/join', label: 'Join code' },
      { href: '/logout', label: 'Sign out' },
    ],
    script: AUTOGROW + HOME_SCRIPT,
    children: html`
      <div class="section-head"><h2>Quick paste</h2><span class="rule"></span>
        <span class="toast" id="quickSaved">saved</span></div>
      <div class="panel">
        <textarea id="quick" rows="4" spellcheck="false"
          placeholder="Paste anything here. It appears on every device with this page open.">${quick}</textarea>
        <div class="row" style="margin-top:11px">
          <button type="button" class="sm" id="copyQuick">Copy</button>
          <button type="button" class="sm ghost" id="clearQuick">Clear</button>
        </div>
      </div>

      <div class="section-head"><h2>Sessions</h2><span class="rule"></span></div>
      <form method="post" action="/sessions" class="row" style="margin-bottom:14px">
        <input type="text" name="title" class="grow sans" placeholder="New session, e.g. Printer on test PC" required>
        <button class="primary" type="submit">Create</button>
      </form>
      <div id="sessions">${raw(sessionList(sessions))}</div>
    `,
  });
}

/* -------------------------------------------------------------- accounts --- */

export function AccountsPage(
  people: { id: string; username: string; role: string; created_at: number }[],
  freshToken?: { username: string; token: string },
  error?: string,
) {
  return Layout({
    title: 'accounts - tempshell',
    where: 'accounts',
    nav: [{ href: '/', label: 'Back' }],
    children: html`
      <div class="section-head"><h2>Accounts</h2><span class="rule"></span></div>
      <p class="small muted" style="margin-top:-4px">
        Each account has its own tempshell sessions and drops, kept private from the others.
        The gallery is shared.
      </p>

      ${freshToken
        ? html`<div class="panel stack" style="border-color:var(--ok)">
            <div><strong>${freshToken.username}</strong> created.</div>
            <div class="small dim">Their API token, shown once. Put it in
              <code>~/.claude/tempshell-token</code> on their machine so their Claude can drive tempshell.</div>
            <pre style="user-select:all">${freshToken.token}</pre>
          </div>`
        : ''}
      ${error ? html`<div class="flash error">${error}</div>` : ''}

      <div class="section-head"><h2>Add someone</h2><span class="rule"></span></div>
      <form method="post" action="/accounts" class="panel stack">
        <input type="text" name="username" class="sans" placeholder="Username (e.g. their first name)"
               autocapitalize="none" required>
        <input type="password" name="password" class="sans" placeholder="Temporary password (they can't change it yet)"
               autocomplete="new-password" required>
        <div class="row"><button class="primary" type="submit">Create account</button></div>
      </form>

      <div class="section-head"><h2>${people.length} account${people.length === 1 ? '' : 's'}</h2><span class="rule"></span></div>
      ${raw(
        people
          .map(
            (u) => `<div class="session-card">
              <div class="grow">
                <div class="title">${esc(u.username)}</div>
                <div class="meta">${u.role === 'owner' ? 'owner (you)' : 'member'}</div>
              </div>
              ${
                u.role === 'owner'
                  ? ''
                  : `<form method="post" action="/accounts/${esc(u.id)}/token"><button class="sm" type="submit">New token</button></form>
                     <form method="post" action="/accounts/${esc(u.id)}/delete" class="confirm-del"><button class="sm ghost danger" type="submit">Remove</button></form>`
              }
            </div>`,
          )
          .join(''),
      )}
      <script>document.querySelectorAll('form.confirm-del').forEach(f=>f.addEventListener('submit',e=>{if(!confirm('Remove this account and everything it owns?'))e.preventDefault();}));</script>
    `,
  });
}

export function sessionList(sessions: SessionRow[]): string {
  if (sessions.length === 0) {
    return '<div class="empty">No sessions yet. Create one above, or ask Claude to start one.</div>';
  }
  return sessions
    .map(
      (s) => `
    <div class="session-card${s.status === 'inactive' || s.status === 'manual' ? ' dim' : ''}">
      <span class="dot dot-${s.status}" title="${STATUS_LABEL[s.status]}"></span>
      <div class="grow">
        <div class="title"><a href="/s/${esc(s.slug)}">${esc(s.title)}</a></div>
        <div class="meta">${STATUS_LABEL[s.status]} / updated ${esc(timeAgo(s.updated_at))}</div>
      </div>
      ${s.pending > 0 && s.status !== 'inactive' ? `<span class="count">${s.pending} waiting</span>` : ''}
      <span class="pill-code">${esc(s.code)}</span>
    </div>`,
    )
    .join('');
}

/* ------------------------------------------------------------- session --- */

/**
 * The command still waiting for an answer, or null. Walks backwards: a reply
 * from a human closes the last command, but a note from Claude does not.
 */
function currentCommand(entries: Entry[]): Entry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.author !== 'claude') return null;
    if (e.kind === 'command') return e;
  }
  return null;
}

export interface SessionView {
  status: SessionStatus;
  busy: boolean;
  /** The one command the agent has actually claimed, if any. */
  runningSeq?: number | null;
  target: { host: string | null; ps_version: string | null; elevated: boolean } | null;
}

/** The one useful thing to say up top: is the agent there, and what is it doing. */
export function statusCard(session: Session, view: SessionView): string {
  const t = view.target;
  const psShort = t?.ps_version ? esc(t.ps_version.split('.').slice(0, 2).join('.')) : '?';
  const targetLine = t
    ? `${esc(t.host ?? '?')} · PS ${psShort} · ${t.elevated ? 'elevated' : 'not elevated'}`
    : '';
  if (session.outcome === 'done') {
    return `<div class="statuscard done">
      <div class="grow">
        <div class="sc-title">Task complete</div>
        <div class="sc-sub small muted">${esc(session.outcome_note || 'Claude reported this task finished.')}</div>
      </div>
    </div>`;
  }
  if (view.status === 'live') {
    const doing = view.busy ? 'running a command' : 'connected, idle';
    return `<div class="statuscard live${view.busy ? ' busy' : ''}">
      <div class="grow">
        <div class="sc-title">Agent connected</div>
        <div class="sc-sub small muted">${targetLine ? targetLine + ' / ' : ''}${doing}</div>
        <div class="working-bar${view.busy ? ' fast' : ''}"></div>
      </div>
      <form method="post" action="/s/${esc(session.slug)}/autorun-stop" class="inline stopform">
        <button type="submit" class="sm ghost danger">Stop</button>
      </form>
    </div>`;
  }
  // inactive: the window was closed or auto-run was stopped
  return `<div class="statuscard inactive">
    <div class="grow">
      <div class="sc-title">Agent not connected</div>
      <div class="sc-sub small muted">The PowerShell window was closed or auto-run was stopped${
        targetLine ? '. Last seen on ' + targetLine : ''
      }. Paste the agent again below to reconnect.</div>
    </div>
  </div>`;
}

/** Anything Claude is holding for a yes/no, most urgent thing on the page. */
export function approvalCards(session: Session, entries: Entry[]): string {
  const held = entries.filter((e) => e.kind === 'command' && e.approval === 'pending');
  if (held.length === 0) return '';
  return held
    .map(
      (e) => `<div class="approval">
      <div class="ap-head">
        <span class="rstat warn">needs your ok</span>
        <span class="grow"></span>
        <span class="when small muted" data-ts="${e.created_at}">${esc(timeAgo(e.created_at))}</span>
      </div>
      <div class="ap-intent">${esc(e.intent ?? 'Run a command')}</div>
      ${e.why ? `<div class="ap-why small muted">${esc(e.why)}</div>` : ''}
      <pre class="act-cmd">${esc(e.body)}</pre>
      <div class="row">
        <form method="post" action="/s/${esc(session.slug)}/approve/${e.seq}" class="inline">
          <button type="submit" class="primary sm">Approve &amp; run</button>
        </form>
        <form method="post" action="/s/${esc(session.slug)}/deny/${e.seq}" class="inline">
          <button type="submit" class="sm ghost danger">Deny</button>
        </form>
        <span class="grow"></span>
        <span class="small dim">Nothing runs until you choose.</span>
      </div>
    </div>`,
    )
    .join('');
}

/**
 * The task summary: the chain of what Claude did and why, newest first, each
 * step carrying its own result. Read-only: this is a record, not a console.
 */
export function activityFeed(entries: Entry[], view?: SessionView): string {
  if (entries.length === 0) {
    return '<div class="empty">Nothing yet. Each step Claude takes will appear here with what it does and why.</div>';
  }
  // Pair every result with the command it answers, so one step reads as one row.
  const resultFor = new Map<number, Entry>();
  for (const e of entries) {
    if (e.reply_to != null && (e.author === 'auto' || e.run_status != null)) resultFor.set(e.reply_to, e);
  }
  const answered = new Set([...resultFor.values()].map((e) => e.seq));

  return [...entries]
    .reverse()
    .filter((e) => !answered.has(e.seq))
    .map((e) => {
      const when = `<span class="when small muted" data-ts="${e.created_at}">${esc(timeAgo(e.created_at))}</span>`;

      if (e.kind === 'file' && e.file_id) {
        return `<div class="act-slot" data-seq="${e.seq}"><div class="act"><div class="act-head"><span class="chip guest">shared</span><span class="grow"></span>${when}</div>${attachmentHtml(e)}</div></div>`;
      }

      if (e.author === 'claude' && e.kind === 'command') {
        const r = resultFor.get(e.seq);
        // Only the command the agent has actually claimed is "running". Anything
        // else without a result is queued, or can no longer run once the agent is
        // gone: claiming "running" forever was simply untrue.
        let stt;
        if (r) stt = r.run_status ?? (r.had_errors ? 'error' : 'ok');
        else if (e.approval === 'pending') stt = 'needs ok';
        else if (e.approval === 'denied') stt = 'denied';
        else if (view && view.runningSeq === e.seq) stt = 'running';
        else if (view && view.status !== 'live') stt = 'not run';
        else stt = 'queued';
        const cls =
          stt === 'ok' ? 'ok'
          : stt === 'running' ? 'run'
          : stt === 'queued' || stt === 'not run' ? 'idle'
          : stt === 'needs ok' || stt === 'timeout' ? 'warn'
          : 'err';
        const dur = r?.duration_ms != null ? `<span class="small muted">${(r.duration_ms / 1000).toFixed(1)}s</span>` : '';
        const badge = e.risk === 'risky' ? '<span class="riskflag">risky</span>' : '';
        return `<div class="act-slot" data-seq="${e.seq}"><div class="act step expandable" role="button" tabindex="0">
          <div class="act-head">
            <span class="rstat ${cls}" data-stat>${esc(stt)}</span>${badge}
            <span class="grow"></span><span data-dur>${dur}</span>${when}
            <span class="caret-x" aria-hidden="true"></span>
          </div>
          <div class="act-intent">${esc(e.intent ?? e.body.split('\n')[0]!.slice(0, 90))}</div>
          ${e.why ? `<div class="act-why small muted">${esc(e.why)}</div>` : ''}
          <div class="act-detail"><div class="act-detail-inner">
            <div class="codeblock">
              <div class="cb-head"><span class="cb-lang">${esc(e.lang || 'powershell')}</span><span class="grow"></span><button type="button" class="sm ghost copy" data-seq="${e.seq}">Copy</button></div>
              <pre class="act-cmd" id="body-${e.seq}">${esc(e.body)}</pre>
            </div>
            ${r ? `<div class="codeblock out">
              <div class="cb-head"><span class="cb-lang">output</span></div>
              <pre class="act-out">${esc(r.body)}</pre>
            </div>` : ''}
          </div></div>
        </div></div>`;
      }

      if (e.kind === 'note') {
        return `<div class="act-slot" data-seq="${e.seq}"><div class="act note"><div class="act-head"><span class="chip claude">note</span><span class="grow"></span>${when}</div><pre class="act-out">${esc(e.body)}</pre></div></div>`;
      }

      if (e.author === 'auto' || e.run_status != null) {
        const stt = e.run_status ?? (e.had_errors ? 'error' : 'ok');
        const cls = stt === 'ok' ? 'ok' : stt === 'timeout' ? 'warn' : 'err';
        const dur = e.duration_ms != null ? `<span class="small muted">${(e.duration_ms / 1000).toFixed(1)}s</span>` : '';
        return `<div class="act-slot" data-seq="${e.seq}"><div class="act"><div class="act-head"><span class="rstat ${cls}">${esc(stt)}</span><span class="grow"></span>${dur}${when}</div><pre class="act-out">${esc(e.body)}</pre></div></div>`;
      }

      return `<div class="act-slot" data-seq="${e.seq}"><div class="act"><div class="act-head"><span class="chip ${esc(e.author)}">${esc(
        AUTHOR_LABEL[e.author] ?? e.author,
      )}</span><span class="grow"></span>${when}</div><pre class="act-out">${esc(e.body)}</pre></div></div>`;
    })
    .join('');
}

function setupCardHtml(slug: string): string {
  return `<div class="panel setup">
    <div class="row">
      <span class="chip auto">Auto-run</span>
      <span class="small dim">Paste this agent once; after that, commands run here on their own.</span>
    </div>
    <ol class="autorun-steps small">
      <li>Open a <strong>PowerShell</strong> window on this machine. Use an <em>admin</em> one if admin-level checks are needed, otherwise any window is fine.</li>
      <li>Copy the agent, paste the whole thing in, and press <strong>Enter</strong> once.</li>
      <li>It asks for an <strong>arming code</strong>. Ask Claude for it, then type it in.</li>
    </ol>
    <div class="row">
      <button type="button" class="primary" id="copyAgent" data-url="/x/${esc(slug)}/agent.ps1">Copy PowerShell agent</button>
      <span class="grow"></span>
      <span class="toast" id="agentCopied">copied</span>
    </div>
  </div>`;
}

/**
 * The whole top of an auto session, so a single fetch can restructure it as the
 * agent connects, disconnects or is stopped: setup while arming, a status line
 * once live, and status + setup again once it drops.
 */
export function topSection(session: Session, view: SessionView, entries: Entry[] = []): string {
  // Anything waiting on a decision goes first: it is blocking the run.
  const approvals = approvalCards(session, entries);
  if (view.status === 'arming') return approvals + setupCardHtml(session.slug);
  if (view.status === 'live') return approvals + statusCard(session, view);
  return approvals + statusCard(session, view) + setupCardHtml(session.slug);
}

export function SessionPage(session: Session, entries: Entry[], isOwner: boolean, view: SessionView) {
  const st = view.status;
  const nav = isOwner
    ? [
        { href: '/', label: 'All sessions' },
        { href: '#delete', label: 'Delete' },
      ]
    : [{ href: '/join', label: 'Leave' }];

  // Manual sessions keep the copy-command / paste-back loop; auto sessions get a
  // status line plus a read-only activity log, and the setup card only while
  // there is no agent connected (arming or disconnected).
  const body =
    st === 'manual'
      ? html`
          <div id="run">${raw(runPanel(entries))}</div>
          <div class="panel" style="margin-top:14px">
            <textarea id="reply" rows="3" spellcheck="false"
              placeholder="Paste the output here. It sends the moment you paste."></textarea>
            <div class="row" style="margin-top:11px">
              <button class="primary" type="button" id="send">Send</button>
              <span class="small muted">sends automatically on paste</span>
              <span class="grow"></span>
              <span class="toast" id="sentTag">sent</span>
            </div>
          </div>
          <div style="margin-top:22px">
            <button type="button" class="ghost sm history-toggle" id="histBtn"
                    data-target="hist">${raw(historyLabel(entries))} <span class="caret"></span></button>
            <div class="disclosure" id="hist"><div id="thread">${raw(threadHtml(entries))}</div></div>
          </div>`
      : html`
          <div id="topsection">${raw(topSection(session, view, entries))}</div>
          <div class="feed-wrap">
            <div class="feed-head small dim">What Claude has done</div>
            <div id="activity">${raw(activityFeed(entries, view))}</div>
          </div>`;

  return Layout({
    title: `${session.title} - tempshell`,
    where: session.title,
    nav,
    script: AUTOGROW + LIVE_TIME + SESSION_SCRIPT,
    children: html`
      ${body}
      ${isOwner
        ? html`<form method="post" action="/s/${session.slug}/delete" id="deleteForm" style="margin-top:26px">
            <button type="submit" class="sm ghost danger">Delete this session</button>
          </form>`
        : ''}
    `,
  });
}

export function historyLabel(entries: Entry[]): string {
  return entries.length === 0 ? 'History' : `History (${entries.length})`;
}

/** Copy button front and centre; the command text is collapsed behind a toggle. */
export function runPanel(entries: Entry[]): string {
  const cmd = currentCommand(entries);
  if (!cmd) {
    return `<div class="run idle"><div class="waiting"><span class="pulse"></span>
      Waiting for the next command</div></div>`;
  }
  return `<div class="run">
    <div class="run-head">
      <span class="chip claude">Claude</span>
      <span class="what">Run this</span>
      <span class="grow"></span>
      <span class="when muted small" data-ts="${cmd.created_at}">${esc(timeAgo(cmd.created_at))}</span>
    </div>
    <div class="run-actions">
      <button type="button" class="primary btn-copy copy" data-seq="${cmd.seq}">Copy command</button>
      <button type="button" class="sm toggle" data-target="cmd-${cmd.seq}">Show <span class="caret"></span></button>
    </div>
    <div class="disclosure" id="cmd-${cmd.seq}"><pre id="body-${cmd.seq}">${esc(cmd.body)}</pre></div>
  </div>`;
}

export function threadHtml(entries: Entry[]): string {
  if (entries.length === 0) {
    return '<div class="empty">Nothing here yet.</div>';
  }
  return entries
    .map((e) => {
      const label = AUTHOR_LABEL[e.author] ?? e.author;
      const isFile = e.kind === 'file' && e.file_id;
      const copy =
        e.kind !== 'note' && !isFile
          ? `<div class="tools"><button type="button" class="sm copy" data-seq="${e.seq}">Copy</button></div>`
          : '';
      const body = isFile ? attachmentHtml(e) : `<pre id="body-${e.seq}">${esc(e.body)}</pre>`;
      return `
    <div class="entry ${esc(e.kind)}">
      <div class="entry-head">
        <span class="chip ${esc(e.author)}">${esc(label)}</span>
        <span class="when" data-ts="${e.created_at}">${esc(timeAgo(e.created_at))}</span>
        ${copy}
      </div>
      ${body}
    </div>`;
    })
    .join('');
}

function attachmentHtml(e: Entry): string {
  const href = `f/${esc(e.file_id!)}`;
  const name = esc(e.file_name ?? e.body);
  const size = e.file_size ? ` · ${formatBytes(e.file_size)}` : '';
  if ((e.file_mime ?? '').startsWith('image/')) {
    return `<a href="${href}" target="_blank" rel="noopener" class="shot">
      <img src="${href}" alt="${name}" loading="lazy">
    </a><div class="small muted" style="margin-top:5px">${name}${size}</div>`;
  }
  return `<a class="btn sm" href="${href}" download>${name}</a>
    <span class="small muted" style="margin-left:8px">${size.replace(' / ', '')}</span>`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* -------------------------------------------------------- client script --- */

const JOIN_SCRIPT = `
const code = document.getElementById('code');
code.addEventListener('input', () => {
  code.value = code.value.replace(/[^0-9]/g, '');
  if (code.value.length === 4) document.getElementById('joinForm').submit();
});
`;

const HOME_SCRIPT = `
const quick = document.getElementById('quick');
const savedTag = document.getElementById('quickSaved');
const fit = autogrow(quick);
let timer, lastSent = quick.value;

function flash(el) { el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 1300); }

function save() {
  if (quick.value === lastSent) return;
  lastSent = quick.value;
  fetch('/quick', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: quick.value }) }).then(() => flash(savedTag));
}
quick.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 400); });
quick.addEventListener('blur', save);

document.getElementById('copyQuick').addEventListener('click', async (e) => {
  await navigator.clipboard.writeText(quick.value);
  const b = e.target, t = b.textContent; b.textContent = 'Copied';
  setTimeout(() => { b.textContent = t; }, 1200);
});
document.getElementById('clearQuick').addEventListener('click', () => {
  quick.value = ''; fit(); save(); quick.focus();
});

const es = new EventSource('/stream');
es.addEventListener('quick', async () => {
  if (document.activeElement === quick) return;   // never clobber active typing
  const d = await (await fetch('/quick', { headers: { accept: 'application/json' } })).json();
  quick.value = d.body; lastSent = d.body; fit();
});
const refreshSessions = async () => {
  const el = document.getElementById('sessions');
  if (el) el.innerHTML = await (await fetch('/sessions/list')).text();
};
es.addEventListener('sessions', refreshSessions);
// A session going quiet (its agent window closed) fires no event: it is the
// absence of a poll, so re-render on a timer too, to let live tick to inactive.
setInterval(refreshSessions, 30000);
`;

const SESSION_SCRIPT = `
const reply = document.getElementById('reply');
const sentTag = document.getElementById('sentTag');
const sendBtn = document.getElementById('send');
const fit = reply ? autogrow(reply) : null;

function flash(el) { if (!el) return; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 1600); }

// Delegated so it survives HTML swaps: copy-command, disclosure toggles, copy-agent.
document.addEventListener('click', async (ev) => {
  const copy = ev.target.closest('button.copy');
  if (copy) {
    const pre = document.getElementById('body-' + copy.dataset.seq);
    if (!pre) return;
    try { await navigator.clipboard.writeText(pre.textContent); } catch (e) { return; }
    const label = copy.textContent; copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = label; }, 1300);
    if (reply) reply.focus();
    return;
  }
  const card = ev.target.closest('.act.expandable');
  if (card && !ev.target.closest('a, button, pre')) {
    card.classList.toggle('open');
    return;
  }
  const tog = ev.target.closest('button.toggle, button.history-toggle');
  if (tog) { document.getElementById(tog.dataset.target).classList.toggle('open'); tog.classList.toggle('toggled'); }
  const agent = ev.target.closest('#copyAgent');
  if (agent) {
    try {
      const text = await (await fetch(agent.dataset.url)).text();
      await navigator.clipboard.writeText(text);
      const tag = document.getElementById('agentCopied'); if (tag) flash(tag);
      agent.textContent = 'Copied. Now paste it into PowerShell';
      setTimeout(() => { agent.textContent = 'Copy PowerShell agent'; }, 2500);
    } catch (e) { alert('Could not copy the agent. Are you signed in to this session?'); }
  }
});

// Manual paste loop, only wired when the paste box exists.
if (reply) {
  let sending = false;
  async function send() {
    if (sending || !reply.value.trim()) return;
    sending = true; sendBtn.disabled = true;
    try {
      await fetch(location.pathname + '/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: reply.value }) });
      reply.value = ''; fit(); flash(sentTag); await refresh();
    } finally { sending = false; sendBtn.disabled = false; }
  }
  sendBtn.addEventListener('click', send);
  reply.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  async function upload(file) {
    if (!file) return; sendBtn.disabled = true; const was = reply.placeholder;
    reply.placeholder = 'Uploading ' + (file.name || 'image') + '...';
    try {
      const fd = new FormData(); fd.append('file', file, file.name || 'pasted.png');
      const r = await fetch(location.pathname + '/upload', { method: 'POST', body: fd });
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert('Upload failed: ' + (e.error || r.status)); }
      else { flash(sentTag); await refresh(); }
    } finally { reply.placeholder = was; sendBtn.disabled = false; }
  }
  reply.addEventListener('paste', (e) => {
    const items = e.clipboardData ? e.clipboardData.items : null;
    if (items) { for (const item of items) { if (item.kind === 'file' && item.type.startsWith('image/')) { e.preventDefault(); upload(item.getAsFile()); return; } } }
    setTimeout(send, 0);
  });
  document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
  document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('dropping'); });
  document.addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('dropping'); if (e.dataTransfer && e.dataTransfer.files.length) upload(e.dataTransfer.files[0]); });
}

// Patch the log in place, keyed by seq, instead of replacing the whole list.
// Replacing it meant every row was destroyed and rebuilt on each poll, so
// nothing could animate and the list flickered. Now untouched rows are left
// alone, changed rows are swapped quietly, and only genuinely new rows animate.
function patchList(container, html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const incoming = Array.from(tmp.children);
  const keyed = incoming.filter((n) => n.dataset && n.dataset.seq);

  // The empty state has no key. Treat it as all-or-nothing so it can never be
  // appended twice, and so it disappears the moment a real row exists.
  if (keyed.length === 0) {
    if (!container.querySelector('.empty')) container.innerHTML = html;
    return;
  }
  const placeholder = container.querySelector('.empty');
  if (placeholder) placeholder.remove();

  const firstPaint = container.querySelector('[data-seq]') === null;
  const existing = new Map();
  Array.from(container.children).forEach((n) => {
    if (n.dataset && n.dataset.seq) existing.set(n.dataset.seq, n);
    else n.remove();
  });

  let prev = null;
  for (const node of keyed) {
    const key = node.dataset.seq;
    const old = existing.get(key);
    if (old) {
      existing.delete(key);
      updateCard(old, node);
      prev = old;
    } else {
      if (!firstPaint) node.classList.add('entering');
      if (prev) prev.after(node);
      else container.prepend(node);
      if (!firstPaint) setTimeout(() => node.classList.remove('entering'), 2200);
      prev = node;
    }
  }
  existing.forEach((n) => n.remove());
}

// Update a card in place rather than replacing it: one block per task, whose
// status changes under you. Replacing the node made a card appear to vanish and
// be swapped for a different one the instant a fast command finished.
function updateCard(oldSlot, newSlot) {
  const a = oldSlot.querySelector('.act');
  const b = newSlot.querySelector('.act');
  if (!a || !b) { if (oldSlot.innerHTML !== newSlot.innerHTML) oldSlot.innerHTML = newSlot.innerHTML; return; }

  const oldStat = a.querySelector('[data-stat]');
  const newStat = b.querySelector('[data-stat]');
  if (oldStat && newStat && oldStat.textContent !== newStat.textContent) {
    oldStat.className = newStat.className;
    oldStat.textContent = newStat.textContent;
    oldStat.classList.remove('flip');
    void oldStat.offsetWidth;          // restart the animation
    oldStat.classList.add('flip');
  }
  const oldDur = a.querySelector('[data-dur]');
  const newDur = b.querySelector('[data-dur]');
  if (oldDur && newDur && oldDur.innerHTML !== newDur.innerHTML) oldDur.innerHTML = newDur.innerHTML;

  // The body (command, and output once it lands) can grow; keep any open state.
  const oldDetail = a.querySelector('.act-detail-inner');
  const newDetail = b.querySelector('.act-detail-inner');
  if (oldDetail && newDetail && oldDetail.innerHTML !== newDetail.innerHTML) {
    oldDetail.innerHTML = newDetail.innerHTML;
  }
  const oldIntent = a.querySelector('.act-intent');
  const newIntent = b.querySelector('.act-intent');
  if (oldIntent && newIntent && oldIntent.textContent !== newIntent.textContent) {
    oldIntent.textContent = newIntent.textContent;
  }
}

// Live refresh for both modes.
async function refresh() {
  const activity = document.getElementById('activity');
  if (activity) {
    const [a, s] = await Promise.all([
      fetch(location.pathname + '/activity').then((r) => r.text()),
      fetch(location.pathname + '/status').then((r) => r.text()),
    ]);
    patchList(activity, a);
    const sc = document.getElementById('topsection');
    // Only rewrite when the markup actually changed, or the "Task complete" card
    // re-mounts on every 15s poll and replays its entry animation (the flashing).
    if (sc && s && sc.dataset.html !== s) {
      const hadApproval = !!sc.querySelector('.approval');
      sc.innerHTML = s;
      sc.dataset.html = s;
      const ap = sc.querySelector('.approval');
      if (ap && !hadApproval) ap.classList.add('fresh');
    }
    tickTimes();
    return;
  }
  const run = document.getElementById('run');
  if (run) {
    const d = await (await fetch(location.pathname + '/live')).json();
    run.innerHTML = d.run;
    const thread = document.getElementById('thread'); if (thread) thread.innerHTML = d.thread;
    const btn = document.getElementById('histBtn'); if (btn) btn.firstChild.textContent = d.label + ' ';
    tickTimes();
  }
}

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const card = ev.target.closest && ev.target.closest('.act.expandable');
  if (card) { ev.preventDefault(); card.classList.toggle('open'); }
});

new EventSource(location.pathname + '/stream').addEventListener('update', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
// A quiet session fires no event, so tick on a timer to let the status card
// fall to "not connected".
setInterval(refresh, 15000);

const form = document.getElementById('deleteForm');
if (form) form.addEventListener('submit', (e) => { if (!confirm('Delete this session and everything in it?')) e.preventDefault(); });
document.querySelectorAll('a[href="#delete"]').forEach((a) => { a.addEventListener('click', (e) => { e.preventDefault(); form && form.requestSubmit(); }); });
`;
