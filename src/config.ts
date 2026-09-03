function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),

  /**
   * The public URL this instance is reachable at, e.g. https://tempshell.example.com.
   * It is baked into the agent the target machine pastes, so the agent knows where to
   * poll back, and into the session links. Must match how the world reaches you.
   */
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),

  /** Per-file cap on pasted screenshots and attachments. */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),

  /** Per-file cap on files the agent pulls off the target machine. */
  maxAgentUploadBytes: Number(process.env.MAX_AGENT_UPLOAD_BYTES ?? 25 * 1024 * 1024),

  /** Where the SQLite file lives. One directory keeps backups trivial. */
  dataDir: process.env.DATA_DIR ?? './data',

  /** Sessions untouched this long are purged (threads hold plaintext output). 0 disables. */
  clipSessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? process.env.CLIP_SESSION_TTL_DAYS ?? 30),

  /** An armed agent idle (no poll) this long is disarmed automatically. 0 disables. */
  autorunIdleMinutes: Number(process.env.AUTORUN_IDLE_MINUTES ?? 60),

  /** scrypt hash of the owner password, from scripts/hash-password.mjs */
  ownerPasswordHash: required('OWNER_PASSWORD_HASH'),

  /** Signs cookies. Rotating it logs everyone out, which is the intended panic button. */
  cookieSecret: required('COOKIE_SECRET'),

  /** Bearer token used by Claude Code and any other script driving this instance. */
  apiToken: required('API_TOKEN'),

  isProduction: process.env.NODE_ENV === 'production',
} as const;
