import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, migrate } from '../db.ts';
import { config } from '../config.ts';
import { generateId, generateJoinCode, slugify } from '../auth.ts';
import { bus } from '../bus.ts';

/**
 * 'admin' is you, signed in. 'guest' is someone who used a join code. 'auto' is
 * the automated executor running commands on the target machine.
 */
export type Author = 'claude' | 'admin' | 'guest' | 'auto';
export type Kind = 'command' | 'output' | 'note' | 'file';

export const AUTHOR_LABEL: Record<Author, string> = {
  claude: 'Claude',
  admin: 'Admin',
  guest: 'Guest',
  auto: 'Auto-run',
};

export interface Session {
  id: string;
  slug: string;
  title: string;
  code: string;
  created_at: number;
  updated_at: number;
  closed: number;
  auto_enabled: number;
  owner: string;
  /** 'done' once the task is reported finished; null while still in progress. */
  outcome?: string | null;
  outcome_note?: string | null;
}

export interface Executor {
  session_id: string;
  arm_hash: string | null;
  arm_expires: number | null;
  token_hash: string | null;
  armed: number;
  stop: number;
  last_seen: number | null;
  created_at: number;
  host: string | null;
  ps_version: string | null;
  elevated: number | null;
}

export interface TargetInfo {
  host?: string;
  user?: string;
  psVersion?: string;
  elevated?: boolean;
}

export interface Entry {
  id: number;
  session_id: string;
  seq: number;
  author: Author;
  kind: Kind;
  body: string;
  lang: string | null;
  file_id: string | null;
  created_at: number;
  /** Structured fields, set only on auto-run outputs. */
  stdout?: string | null;
  stderr?: string | null;
  exit_code?: number | null;
  duration_ms?: number | null;
  truncated?: number | null;
  run_status?: string | null;
  had_errors?: number | null;
  reply_to?: number | null;
  errors_json?: string | null;
  /** The action log: what this command does, why, and whether it needed a yes. */
  intent?: string | null;
  why?: string | null;
  risk?: string | null; // 'safe' | 'risky'
  approval?: string | null; // null (nothing to approve) | 'pending' | 'approved' | 'denied'
  decided_at?: number | null;
  decided_by?: string | null;
  /** Joined from files when the entry carries an attachment. */
  file_mime?: string | null;
  file_name?: string | null;
  file_size?: number | null;
}

export interface AutoResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number | null;
  truncated: boolean;
  status: string; // 'ok' | 'timeout' | 'error'
  hadErrors: boolean;
  /** The command seq this answers, for an unambiguous reply link. */
  replyTo?: number | null;
  /** Structured error records as posted by the agent (kept as JSON text). */
  errorsJson?: string | null;
}

export interface StoredFile {
  id: string;
  session_id: string;
  name: string;
  mime: string;
  size: number;
  created_at: number;
}

const db = openDb('tempshell');

migrate(db, [
  `
  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL,
    code       TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed     INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    author     TEXT NOT NULL,
    kind       TEXT NOT NULL,
    body       TEXT NOT NULL,
    lang       TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX entries_by_session ON entries (session_id, seq);
  CREATE TABLE quick (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    body       TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );
  INSERT INTO quick (id, body, updated_at) VALUES (1, '', 0);
  `,
  // Authors used to be a flat 'me'. Split into admin and guest so the thread
  // shows who actually pasted each result.
  `UPDATE entries SET author = 'admin' WHERE author = 'me';`,
  // Pasted screenshots. Bytes live on disk under DATA_DIR/files; only metadata
  // goes in the database, so the table stays small and backups stay fast.
  `
  CREATE TABLE files (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE entries ADD COLUMN file_id TEXT;
  `,
  // Auto-run: an opt-in per session where a pasted agent executes commands on
  // the target machine automatically. Off by default; nothing here touches the
  // manual copy-and-paste path.
  //
  // NOTE ON ORDER: migrations run by array index and the index is recorded, so
  // a new migration must be APPENDED, never inserted before an existing one.
  // This auto-run migration shipped before multi-user, so it stays ahead of it.
  `
  ALTER TABLE sessions ADD COLUMN auto_enabled INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE executors (
    session_id  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    arm_hash    TEXT,               -- hashed single-use arming code
    arm_expires INTEGER,            -- arming code TTL
    token_hash  TEXT,              -- hashed executor token, set once armed
    armed       INTEGER NOT NULL DEFAULT 0,
    stop        INTEGER NOT NULL DEFAULT 0,
    last_seen   INTEGER,
    created_at  INTEGER NOT NULL
  );
  `,
  // Per-user ownership (appended after auto-run so indices are stable). Existing
  // rows belong to the owner. Quick paste becomes one row per user; the old
  // table's CHECK (id = 1) forbids that, so it is rebuilt keyed by owner and the
  // owner's current clipboard carried across.
  `
  ALTER TABLE sessions ADD COLUMN owner TEXT NOT NULL DEFAULT 'owner';
  CREATE TABLE quick2 (
    owner      TEXT PRIMARY KEY,
    body       TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );
  INSERT INTO quick2 (owner, body, updated_at) SELECT 'owner', body, updated_at FROM quick WHERE id = 1;
  DROP TABLE quick;
  ALTER TABLE quick2 RENAME TO quick;
  `,
  // Explicit per-command execution state for auto-run, so completion is never
  // inferred from the presence of an output. A command is pending until the
  // agent claims it and reports it done; a claim expires so a crashed run
  // retries instead of vanishing. Plus a handshake of what the target actually is.
  `
  CREATE TABLE exec_commands (
    session_id TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    state      TEXT NOT NULL DEFAULT 'pending',
    claimed_at INTEGER,
    done_at    INTEGER,
    PRIMARY KEY (session_id, seq)
  );
  ALTER TABLE executors ADD COLUMN host TEXT;
  ALTER TABLE executors ADD COLUMN ps_version TEXT;
  ALTER TABLE executors ADD COLUMN elevated INTEGER;
  `,
  // Structured auto-run results: stderr kept apart from stdout (the signal in a
  // troubleshooting session), plus exit code, duration, a truncation flag and a
  // run status (ok / timeout). The human-facing flattened text still lives in
  // entries.body; these are nullable and only set on auto outputs.
  `
  ALTER TABLE entries ADD COLUMN stdout TEXT;
  ALTER TABLE entries ADD COLUMN stderr TEXT;
  ALTER TABLE entries ADD COLUMN exit_code INTEGER;
  ALTER TABLE entries ADD COLUMN duration_ms INTEGER;
  ALTER TABLE entries ADD COLUMN truncated INTEGER;
  ALTER TABLE entries ADD COLUMN run_status TEXT;
  `,
  // A reliable did-it-fail signal. exit_code is the process exit, which is 0
  // even when a cmdlet wrote an error record, so it is not a success test on
  // its own. had_errors is true when the command produced error records or $?
  // was false.
  `ALTER TABLE entries ADD COLUMN had_errors INTEGER;`,
  // Link each auto result to the command it answers (so the thread is
  // unambiguous even if commands ever run concurrently), and keep the full
  // structured error records : id, category, exception type, target, line :
  // that the flat stderr string throws away, so a caller can tell access-denied
  // from not-found without another round trip.
  `
  ALTER TABLE entries ADD COLUMN reply_to INTEGER;
  ALTER TABLE entries ADD COLUMN errors_json TEXT;
  `,
  // The action log: every command carries what Claude is doing and why, so the
  // session page reads as a chain of intentions rather than raw shell. Anything
  // flagged risky is held at 'pending' until a human at the machine approves or
  // denies it : the agent is never served a command that is awaiting a decision.
  `
  ALTER TABLE entries ADD COLUMN intent TEXT;
  ALTER TABLE entries ADD COLUMN why TEXT;
  ALTER TABLE entries ADD COLUMN risk TEXT;
  ALTER TABLE entries ADD COLUMN approval TEXT;
  ALTER TABLE entries ADD COLUMN decided_at INTEGER;
  `,
  // Who pressed Approve/Deny, so the API can tell a fast human from a bypass.
  // And how the session ended: 'done' when Claude reports the task finished,
  // so a completed run does not read like a failure.
  `
  ALTER TABLE entries ADD COLUMN decided_by TEXT;
  ALTER TABLE sessions ADD COLUMN outcome TEXT;
  ALTER TABLE sessions ADD COLUMN outcome_note TEXT;
  `,
]);

export const filesDir = join(config.dataDir, 'files');
mkdirSync(filesDir, { recursive: true });

export function filePath(id: string): string {
  return join(filesDir, id);
}

/* ------------------------------------------------------------- sessions --- */

export function listSessions(owner: string, includeClosed = false): Session[] {
  const sql = includeClosed
    ? 'SELECT * FROM sessions WHERE owner = ? ORDER BY updated_at DESC'
    : 'SELECT * FROM sessions WHERE owner = ? AND closed = 0 ORDER BY updated_at DESC';
  return db.prepare(sql).all(owner) as unknown as Session[];
}

/**
 * 'live'     : auto-run agent armed and polling right now.
 * 'arming'   : auto-run on, waiting for the person to paste and arm the agent.
 * 'inactive' : the agent stopped, was disarmed, or its window was closed (its
 *              poll heartbeat went stale). A finished session lands here.
 * 'manual'   : no agent; a plain copy-and-paste session.
 * The live/stale line is the agent's last poll: it polls every couple of
 * seconds, so no poll for LIVE_WINDOW_MS means the window is gone.
 */
export type SessionStatus = 'live' | 'arming' | 'inactive' | 'manual';
const LIVE_WINDOW_MS = 90_000;

export function sessionStatus(s: Session): SessionStatus {
  const ex = getExecutor(s.id);
  if (!s.auto_enabled) {
    // haltAuto clears auto_enabled, so a stopped auto-run session lands here
    // with its executor row still present : that is 'inactive', not 'manual'.
    return ex && ex.stop ? 'inactive' : 'manual';
  }
  if (!ex || !ex.armed) return 'arming';
  if (ex.stop) return 'inactive';
  // A running command freezes last_seen (the agent can't poll while executing),
  // so a claimed-but-unfinished command counts as alive too.
  if (runningSince(s.id) != null) return 'live';
  if (ex.last_seen && Date.now() - ex.last_seen < LIVE_WINDOW_MS) return 'live';
  return 'inactive';
}

export function createSession(title: string, owner: string): Session {
  const now = Date.now();
  const clean = plainText(title).slice(0, 120) || 'Untitled session';

  // Only 9000 codes exist, so collisions matter. Retry generously and fail
  // loudly rather than handing out a duplicate.
  let code = generateJoinCode();
  let tries = 0;
  while (getSessionByCode(code)) {
    if (++tries > 500) throw new Error('No free join codes. Delete some old sessions.');
    code = generateJoinCode();
  }

  const session: Session = {
    id: generateId(),
    slug: slugify(clean),
    title: clean,
    code,
    created_at: now,
    updated_at: now,
    closed: 0,
    auto_enabled: 0,
    owner,
  };
  db.prepare(
    'INSERT INTO sessions (id, slug, title, code, created_at, updated_at, closed, owner) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
  ).run(session.id, session.slug, session.title, session.code, now, now, owner);
  bus.publish('sessions');
  return session;
}

export function getSession(slug: string): Session | null {
  return (db.prepare('SELECT * FROM sessions WHERE slug = ?').get(slug) as unknown as Session) ?? null;
}

/** Remove every session (and its files, via deleteSession) a user owned. */
export function deleteOwner(owner: string): void {
  for (const s of listSessions(owner, true)) deleteSession(s.id);
  db.prepare('DELETE FROM quick WHERE owner = ?').run(owner);
}

export function getSessionByCode(code: string): Session | null {
  return (db.prepare('SELECT * FROM sessions WHERE code = ?').get(code) as unknown as Session) ?? null;
}

export function renameSession(id: string, title: string): void {
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title.trim().slice(0, 120), Date.now(), id);
  bus.publish('sessions');
}

export function setClosed(id: string, closed: boolean): void {
  db.prepare('UPDATE sessions SET closed = ?, updated_at = ? WHERE id = ?').run(closed ? 1 : 0, Date.now(), id);
  bus.publish('sessions');
}

export function deleteSession(id: string): void {
  // Rows cascade, but the bytes on disk do not. Remove them first.
  for (const f of listFiles(id)) rmSync(filePath(f.id), { force: true });
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  bus.publish('sessions');
}

/* ---------------------------------------------------------------- files --- */

export function listFiles(sessionId: string): StoredFile[] {
  return db.prepare('SELECT * FROM files WHERE session_id = ?').all(sessionId) as unknown as StoredFile[];
}

export function getFile(id: string): StoredFile | null {
  return (db.prepare('SELECT * FROM files WHERE id = ?').get(id) as unknown as StoredFile) ?? null;
}

export function saveFile(sessionId: string, name: string, mime: string, bytes: Uint8Array): StoredFile {
  const file: StoredFile = {
    id: generateId(16),
    session_id: sessionId,
    name: name.slice(0, 200) || 'pasted',
    mime,
    size: bytes.byteLength,
    created_at: Date.now(),
  };
  writeFileSync(filePath(file.id), bytes);
  db.prepare('INSERT INTO files (id, session_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    file.id,
    file.session_id,
    file.name,
    file.mime,
    file.size,
    file.created_at,
  );
  return file;
}

/* -------------------------------------------------------------- entries --- */

export function listEntries(sessionId: string, sinceSeq = 0): Entry[] {
  return db
    .prepare(
      `SELECT e.*, f.mime AS file_mime, f.name AS file_name, f.size AS file_size
       FROM entries e LEFT JOIN files f ON f.id = e.file_id
       WHERE e.session_id = ? AND e.seq > ? ORDER BY e.seq`,
    )
    .all(sessionId, sinceSeq) as unknown as Entry[];
}

/**
 * Normalise text that a person or Claude authored: titles, intents, reasons.
 * Two jobs. It drops U+FFFD, which is what a title looks like after a shell has
 * mangled it on the way in and is where the stray '?' in the page header came
 * from. And it flattens the typographic characters that read as machine-written
 * (em and en dashes, curly quotes, ellipsis) to their plain ASCII equivalents.
 *
 * Letters are never touched, so aa/ae/oe and every other accent survives intact.
 * Never apply this to a command body or to captured output: those must stay
 * byte-exact.
 */
export function plainText(s: string): string {
  // Typographic normalisation only: it must NEVER remove letters. Every target is
  // written as an escape rather than a literal, because literals in this file have
  // been mangled by an editor before now, and a mangled literal inside a character
  // class silently becomes a RANGE that swallows real letters. That is what was
  // destroying Norwegian titles.
  return s
    .replace(/\uFFFD/g, '')                          // already-mangled text from upstream
    .replace(/[\u2014\u2013\u2212]/g, '-')          // em dash, en dash, minus
    .replace(/[\u2018\u2019\u201B]/g, "'")         // curly single quotes
    .replace(/[\u201C\u201D]/g, '"')               // curly double quotes
    .replace(/\u2026/g, '...')                       // ellipsis
    .replace(/[\u2022\u00B7]/g, '-')               // bullet, middot
    .replace(/\u00A0/g, ' ')                         // non-breaking space
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Commands that change the machine, recognised from the text itself.
 *
 * The approval gate cannot rely on Claude flagging its own command: the moment
 * it matters most is when the model is careless or has lost context, which is
 * exactly when the flag goes missing. So the server decides too, and the stricter
 * of the two wins. Read-only verbs (Get-, Test-, Measure-) are deliberately not
 * here; holding those would train the reader to approve without looking.
 */
const RISKY_PATTERNS: RegExp[] = [
  /\bRemove-Item(Property)?\b/i,
  /\bClear-(Content|Disk|EventLog|RecycleBin)\b/i,
  /\b(Stop|Restart|Set)-Service\b/i,
  /\bStop-Process\b/i,
  /\b(Stop|Restart)-Computer\b/i,
  /\b(Set|New)-ItemProperty\b/i,
  /HKLM:|HKEY_LOCAL_MACHINE/i,
  /\breg(\.exe)?\s+(add|delete|import)\b/i,
  /\bgpupdate\b/i,
  /\bmsiexec\b/i,
  /\bUninstall-\w+/i,
  /\bSet-ExecutionPolicy\b/i,
  /\bshutdown(\.exe)?\b/i,
  /\bdiskpart\b/i,
  /\bformat\s+[a-z]:/i,
  /\b(New-LocalUser|Add-LocalGroupMember|Remove-LocalUser)\b/i,
  /\bnet\s+(user|localgroup)\b/i,
  /\b(takeown|icacls)\b/i,
  /\b(Disable|Enable)-(Service|WindowsOptionalFeature|NetAdapter|ScheduledTask|LocalUser)\b/i,
  /\b(Set-Content|Out-File)\b/i,
  /\b(rd|rmdir)\s+\/s\b/i,
  /\bdel\s+\/[qsf]/i,
  /\bStart-Process\b[^\n]*-Verb\s+RunAs/i,
  /\bInvoke-Expression\b/i,
];

/** True when the command text alone is enough to warrant a human decision. */
export function looksRisky(body: string): boolean {
  return RISKY_PATTERNS.some((re) => re.test(body));
}

export interface ActionMeta {
  /** One line: what this does. */
  intent?: string | null;
  /** One line: why it is being done. */
  why?: string | null;
  /** 'risky' holds the command for approval; anything else runs straight away. */
  risk?: string | null;
}

export function addEntry(
  sessionId: string,
  author: Author,
  kind: Kind,
  body: string,
  lang: string | null = null,
  fileId: string | null = null,
  meta: ActionMeta = {},
): Entry {
  const now = Date.now();
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS max FROM entries WHERE session_id = ?')
    .get(sessionId) as unknown as { max: number };
  const seq = Number(row.max) + 1;

  // The stricter of the two verdicts wins: what Claude declared, and what the
  // command text actually looks like. A missing or wrong flag cannot open the gate.
  const declaredRisky = meta.risk === 'risky';
  const detectedRisky = kind === 'command' && looksRisky(body);
  const risk = declaredRisky || detectedRisky ? 'risky' : meta.risk ? 'safe' : null;
  // Only a risky command waits for a human; everything else has nothing to decide.
  const approval = risk === 'risky' && kind === 'command' ? 'pending' : null;

  db.prepare(
    `INSERT INTO entries (session_id, seq, author, kind, body, lang, file_id, created_at,
       intent, why, risk, approval)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    seq,
    author,
    kind,
    body,
    lang,
    fileId,
    now,
    meta.intent ? plainText(String(meta.intent)).slice(0, 300) : null,
    meta.why ? plainText(String(meta.why)).slice(0, 600) : null,
    risk,
    approval,
  );
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

  // Two channels: one for anyone watching the thread, one that only fires on
  // replies from a human, which is what the long-poll endpoint waits on.
  bus.publish(`session:${sessionId}`);
  if (author !== 'claude') bus.publish(`reply:${sessionId}`);
  bus.publish('sessions');

  return listEntries(sessionId, seq - 1)[0]!;
}

/**
 * Records an auto-run result: a flattened body for the human view, plus the
 * structured fields (stderr apart from stdout, exit code, duration, truncation,
 * status) for the caller. Fires the same buses as a human reply.
 */
export function addResult(sessionId: string, result: AutoResult): Entry {
  const now = Date.now();
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS max FROM entries WHERE session_id = ?')
    .get(sessionId) as unknown as { max: number };
  const seq = Number(row.max) + 1;

  // Flattened text for the thread: stdout, then stderr under a marker if present.
  let body = result.stdout.trim();
  if (result.stderr.trim()) body = (body ? body + '\n\n' : '') + '[stderr]\n' + result.stderr.trim();
  if (result.status === 'timeout') body = (body ? body + '\n\n' : '') + '[timed out]';
  if (!body) body = '(no output)';

  // A command that wrote errors but exited 0 still failed; surface that in status.
  const status = result.status === 'ok' && result.hadErrors ? 'error' : result.status;
  db.prepare(
    `INSERT INTO entries (session_id, seq, author, kind, body, lang, file_id, created_at,
       stdout, stderr, exit_code, duration_ms, truncated, run_status, had_errors, reply_to, errors_json)
     VALUES (?, ?, 'auto', 'output', ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    seq,
    body.slice(0, 1_000_000),
    now,
    result.stdout.slice(0, 500_000),
    result.stderr.slice(0, 500_000) || null,
    result.exitCode,
    result.durationMs,
    result.truncated ? 1 : 0,
    status,
    result.hadErrors ? 1 : 0,
    result.replyTo == null ? null : Number(result.replyTo),
    result.errorsJson ? result.errorsJson.slice(0, 200_000) : null,
  );
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
  bus.publish(`session:${sessionId}`);
  bus.publish(`reply:${sessionId}`);
  bus.publish('sessions');
  return listEntries(sessionId, seq - 1)[0]!;
}

export function latestSeq(sessionId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS max FROM entries WHERE session_id = ?')
    .get(sessionId) as unknown as { max: number };
  return Number(row.max);
}

/** How many commands are waiting with no answer after them. Drives the badge. */
export function pendingCommands(sessionId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM entries e
       WHERE e.session_id = ? AND e.author = 'claude' AND e.kind = 'command'
         AND NOT EXISTS (
           SELECT 1 FROM entries r
           WHERE r.session_id = e.session_id AND r.seq > e.seq AND r.author <> 'claude'
         )`,
    )
    .get(sessionId) as unknown as { n: number };
  return Number(row.n);
}

/* ---------------------------------------------------------------- quick --- */

export function getQuick(owner: string): { body: string; updated_at: number } {
  const row = db.prepare('SELECT body, updated_at FROM quick WHERE owner = ?').get(owner) as unknown as
    | { body: string; updated_at: number }
    | undefined;
  return row ?? { body: '', updated_at: 0 };
}

export function setQuick(owner: string, body: string): void {
  db.prepare(
    `INSERT INTO quick (owner, body, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(owner) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
  ).run(owner, body, Date.now());
  // Scope the live-sync event to this owner so one user's paste does not ping
  // another user's open tab.
  bus.publish(`quick:${owner}`);
}

/* ------------------------------------------------------------ retention --- */

/**
 * Purges sessions untouched for the TTL : their threads hold plaintext command
 * output (hostnames, usernames, paths) : and disarms auto-run agents that have
 * gone idle, so a machine is never left with a live unattended shell because
 * someone forgot to stop it.
 */
export function sweep(): { purged: number; disarmed: number } {
  const now = Date.now();
  let purged = 0;
  if (config.clipSessionTtlDays > 0) {
    const cutoff = now - config.clipSessionTtlDays * 86_400_000;
    for (const s of db.prepare('SELECT id FROM sessions WHERE updated_at < ?').all(cutoff) as unknown as {
      id: string;
    }[]) {
      deleteSession(s.id);
      purged++;
    }
  }
  let disarmed = 0;
  if (config.autorunIdleMinutes > 0) {
    const idleCutoff = now - config.autorunIdleMinutes * 60_000;
    for (const ex of db
      .prepare('SELECT session_id FROM executors WHERE armed = 1 AND stop = 0 AND (last_seen IS NULL OR last_seen < ?)')
      .all(idleCutoff) as unknown as { session_id: string }[]) {
      haltAuto(ex.session_id);
      disarmed++;
    }
  }
  return { purged, disarmed };
}

setInterval(() => {
  try {
    const r = sweep();
    if (r.purged || r.disarmed) console.log(`[tempshell] swept ${r.purged} session(s), disarmed ${r.disarmed} idle agent(s)`);
  } catch (error) {
    console.error('[tempshell] sweep failed', error);
  }
}, 3_600_000).unref();

/* ------------------------------------------------------------- auto-run --- */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
// 15 minutes: the arming code is delivered in chat, and there is no telling when
// the person at the machine will read it, so a short window races human latency.
const ARM_TTL_MS = 15 * 60 * 1000;

export function getExecutor(sessionId: string): Executor | null {
  return (db.prepare('SELECT * FROM executors WHERE session_id = ?').get(sessionId) as unknown as Executor) ?? null;
}

/** Turn on auto-run for a session and mint a fresh single-use arming code. */
export function enableAuto(sessionId: string): string {
  // 4 digits to match the join code. Safe because it is single-use, expires in
  // 15 minutes, is delivered through Claude rather than guessed, and the arm
  // endpoint is rate limited per IP and against the global guess budget.
  const code = String(randomInt(1_000, 10_000));
  const now = Date.now();
  db.prepare('UPDATE sessions SET auto_enabled = 1 WHERE id = ?').run(sessionId);
  db.prepare(
    `INSERT INTO executors (session_id, arm_hash, arm_expires, token_hash, armed, stop, created_at)
     VALUES (?, ?, ?, NULL, 0, 0, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       arm_hash = excluded.arm_hash, arm_expires = excluded.arm_expires,
       token_hash = NULL, armed = 0, stop = 0`,
  ).run(sessionId, sha(code), now + ARM_TTL_MS, now);
  bus.publish(`session:${sessionId}`);
  return code;
}

/**
 * Turn auto-run off and back to manual. The executor row is kept with stop=1
 * rather than deleted, so a still-running agent gets a clean {stop:true} on its
 * next poll and exits, instead of a 401 it would retry forever. A later
 * enableAuto resets the row; deleting the session cascades it away.
 */
export function haltAuto(sessionId: string): void {
  db.prepare('UPDATE sessions SET auto_enabled = 0 WHERE id = ?').run(sessionId);
  db.prepare('UPDATE executors SET stop = 1 WHERE session_id = ?').run(sessionId);
  bus.publish(`session:${sessionId}`);
}

/**
 * Exchange a valid arming code for an executor token. Single use: the arming
 * hash is cleared whether or not it matched, so a wrong guess burns nothing but
 * a correct one cannot be replayed. Rate limiting lives in the route.
 */
export function armExecutor(sessionId: string, code: string, target?: TargetInfo): string | null {
  const ex = getExecutor(sessionId);
  if (!ex || !ex.arm_hash || !ex.arm_expires) return null;
  if (ex.arm_expires < Date.now()) return null;

  const a = Buffer.from(sha(code));
  const b = Buffer.from(ex.arm_hash);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) return null;

  const token = randomBytes(32).toString('base64url');
  db.prepare(
    `UPDATE executors SET arm_hash = NULL, arm_expires = NULL, token_hash = ?, armed = 1, stop = 0,
       last_seen = ?, host = ?, ps_version = ?, elevated = ? WHERE session_id = ?`,
  ).run(
    sha(token),
    Date.now(),
    target?.host ?? null,
    target?.psVersion ?? null,
    target?.elevated == null ? null : target.elevated ? 1 : 0,
    sessionId,
  );
  return token;
}

/** Resolve an executor bearer token to its session, and mark it alive. */
export function executorBySession(sessionId: string, token: string): Executor | null {
  const ex = getExecutor(sessionId);
  if (!ex || !ex.armed || !ex.token_hash) return null;
  const a = Buffer.from(sha(token));
  const b = Buffer.from(ex.token_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  db.prepare('UPDATE executors SET last_seen = ? WHERE session_id = ?').run(Date.now(), sessionId);
  return ex;
}

const CLAIM_TTL_MS = 90_000;

/**
 * Atomically hand the agent the next command to run: the lowest-seq command that
 * is not done and not freshly claimed. Marks it claimed so a second poll does
 * not double-serve it, while an expired claim (a crashed run) is re-served. This
 * is what makes the queue lossless : completion is tracked, never inferred.
 */
export function claimNextCommand(sessionId: string): Entry | null {
  const staleBefore = Date.now() - CLAIM_TTL_MS;
  let claimed: Entry | null = null;
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db
      .prepare(
        // NULL-safe: with no exec_commands row yet, x.state is NULL and a bare
        // NOT(...) over it evaluates to NULL and wrongly excludes the row. Spell
        // out eligibility positively instead. Eligible = not done, and not a
        // still-fresh claim.
        // A command awaiting or refused a decision is never served: 'pending'
        // waits for the person at the machine, 'denied' never runs at all.
        `SELECT e.* FROM entries e
         LEFT JOIN exec_commands x ON x.session_id = e.session_id AND x.seq = e.seq
         WHERE e.session_id = ? AND e.author = 'claude' AND e.kind = 'command'
           AND COALESCE(x.state, 'pending') <> 'done'
           AND (e.approval IS NULL OR e.approval = 'approved')
           AND (x.state IS NULL OR x.state <> 'claimed' OR x.claimed_at < ?)
         ORDER BY e.seq LIMIT 1`,
      )
      .get(sessionId, staleBefore) as unknown as Entry | undefined;
    if (row) {
      db.prepare(
        `INSERT INTO exec_commands (session_id, seq, state, claimed_at) VALUES (?, ?, 'claimed', ?)
         ON CONFLICT(session_id, seq) DO UPDATE SET state = 'claimed', claimed_at = excluded.claimed_at`,
      ).run(sessionId, row.seq, Date.now());
      claimed = row;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return claimed;
}

export function markCommandDone(sessionId: string, seq: number): void {
  db.prepare(
    `INSERT INTO exec_commands (session_id, seq, state, done_at) VALUES (?, ?, 'done', ?)
     ON CONFLICT(session_id, seq) DO UPDATE SET state = 'done', done_at = excluded.done_at`,
  ).run(sessionId, seq, Date.now());
}

/** Command seqs the agent has not yet reported done. Surfaces silent stalls. */
/**
 * When the agent is mid-command, its poll heartbeat (last_seen) is frozen : it
 * cannot poll while executing. This returns the claim time of a command that has
 * been claimed but not reported done, so callers can tell a busy agent from a
 * dead one instead of reading a stale last_seen as "gone".
 */
export function runningSince(sessionId: string): number | null {
  const row = db
    .prepare(
      `SELECT MIN(claimed_at) AS started FROM exec_commands
       WHERE session_id = ? AND state = 'claimed' AND done_at IS NULL`,
    )
    .get(sessionId) as unknown as { started: number | null };
  return row?.started ?? null;
}

/** Commands held for a human decision, oldest first. */
export function pendingApprovals(sessionId: string): Entry[] {
  return db
    .prepare(
      `SELECT * FROM entries
       WHERE session_id = ? AND kind = 'command' AND approval = 'pending'
       ORDER BY seq`,
    )
    .all(sessionId) as unknown as Entry[];
}

/**
 * Approve or deny one held command. Returns the entry as it now stands, or null
 * if that seq was not actually awaiting a decision (already decided, or never
 * needed one) : so a double-click cannot approve something twice.
 */
export function decideCommand(sessionId: string, seq: number, approve: boolean, by = 'human'): Entry | null {
  const info = db
    .prepare(
      `UPDATE entries SET approval = ?, decided_at = ?, decided_by = ?
       WHERE session_id = ? AND seq = ? AND approval = 'pending'`,
    )
    .run(approve ? 'approved' : 'denied', Date.now(), by, sessionId, seq);
  if (!info.changes) return null;
  // A denial is terminal: close the command out so nothing waits on it.
  if (!approve) markCommandDone(sessionId, seq);
  bus.publish(`session:${sessionId}`);
  bus.publish('sessions');
  return (
    (db.prepare('SELECT * FROM entries WHERE session_id = ? AND seq = ?').get(sessionId, seq) as unknown as Entry) ??
    null
  );
}

/** Mark how the run ended, so the page can say "finished" rather than "stopped". */
export function setOutcome(sessionId: string, outcome: string | null, note: string | null): void {
  db.prepare('UPDATE sessions SET outcome = ?, outcome_note = ?, updated_at = ? WHERE id = ?')
    .run(outcome, note, Date.now(), sessionId);
  bus.publish(`session:${sessionId}`);
  bus.publish('sessions');
}

/**
 * The seq the agent has actually claimed and not yet reported done, or null.
 * A command sitting in the queue is not "running": without this, every unstarted
 * command claimed to be running forever once the agent went away.
 */
export function runningCommandSeq(sessionId: string): number | null {
  const row = db
    .prepare(
      `SELECT seq FROM exec_commands
       WHERE session_id = ? AND state = 'claimed' AND done_at IS NULL
       ORDER BY claimed_at LIMIT 1`,
    )
    .get(sessionId) as unknown as { seq: number } | undefined;
  return row ? Number(row.seq) : null;
}

export function pendingCommandSeqs(sessionId: string): number[] {
  return (
    db
      .prepare(
        `SELECT e.seq FROM entries e
         LEFT JOIN exec_commands x ON x.session_id = e.session_id AND x.seq = e.seq
         WHERE e.session_id = ? AND e.author = 'claude' AND e.kind = 'command'
           AND COALESCE(x.state, 'pending') <> 'done'
         ORDER BY e.seq`,
      )
      .all(sessionId) as unknown as { seq: number }[]
  ).map((r) => Number(r.seq));
}
