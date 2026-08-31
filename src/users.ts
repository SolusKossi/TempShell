import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { openDb, migrate } from './db.ts';
import { config } from './config.ts';
import { generateId, hashPassword, verifyPassword } from './auth.ts';

/**
 * Accounts. One owner (you) plus any members (e.g. a colleague) you create.
 * Each user has their own login and their own API token; sessions and
 * drops are scoped per user so members never see each other's. The gallery is
 * deliberately shared and is not scoped here.
 */
export interface User {
  id: string;
  username: string;
  password_hash: string;
  token_hash: string;
  role: 'owner' | 'member';
  created_at: number;
}

const db = openDb('users');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

migrate(db, [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    token_hash    TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member',
    created_at    INTEGER NOT NULL
  );
  `,
]);

/**
 * The owner is seeded from the environment on first boot, so the password and
 * API token you already use keep working, now as this user's credentials -
 * and every code path can go through the users table uniformly.
 */
export const OWNER_ID = 'owner';
const OWNER_USERNAME = process.env.OWNER_USERNAME ?? 'martin';

export function seedOwner(): void {
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(OWNER_ID);
  if (existing) {
    // Keep the owner's credentials in step with the environment on every boot,
    // so rotating OWNER_PASSWORD_HASH or API_TOKEN in .env takes effect.
    db.prepare('UPDATE users SET password_hash = ?, token_hash = ? WHERE id = ?').run(
      config.ownerPasswordHash,
      sha(config.apiToken),
      OWNER_ID,
    );
    return;
  }
  db.prepare(
    'INSERT INTO users (id, username, password_hash, token_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(OWNER_ID, OWNER_USERNAME, config.ownerPasswordHash, sha(config.apiToken), 'owner', Date.now());
}
seedOwner();

/* ---------------------------------------------------------------- lookups --- */

export function byId(id: string): User | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as User) ?? null;
}

export function byUsername(username: string): User | null {
  return (db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as unknown as User) ?? null;
}

export function listUsers(): User[] {
  return db.prepare('SELECT * FROM users ORDER BY role = ? DESC, created_at').all('owner') as unknown as User[];
}

/* ------------------------------------------------------------------ auth --- */

/** Resolves a username+password to a user id, in constant-ish time. */
export function login(username: string, password: string): string | null {
  const user = byUsername(username);
  // Verify against a fixed dummy hash when the user is missing, so a wrong
  // username and a wrong password take about the same time.
  const hash = user?.password_hash ?? 'scrypt:00:00';
  const ok = verifyPassword(password, hash);
  return ok && user ? user.id : null;
}

/** Resolves an API bearer token to a user id. */
export function byToken(token: string): string | null {
  if (!token) return null;
  const want = Buffer.from(sha(token));
  for (const u of db.prepare('SELECT id, token_hash FROM users').all() as unknown as {
    id: string;
    token_hash: string;
  }[]) {
    const have = Buffer.from(u.token_hash);
    if (have.length === want.length && timingSafeEqual(have, want)) return u.id;
  }
  return null;
}

/* -------------------------------------------------------------- mutations --- */

export interface NewUser {
  id: string;
  username: string;
  token: string;
}

/** Creates a member and returns its one-time API token (never stored in clear). */
export function createUser(username: string, password: string): NewUser {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (clean.length < 2) throw new Error('Username must be at least 2 characters (letters, digits, . _ -).');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (byUsername(clean)) throw new Error('That username is taken.');

  const id = generateId(12);
  const token = randomBytes(32).toString('hex');
  db.prepare(
    'INSERT INTO users (id, username, password_hash, token_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, clean, hashPassword(password), sha(token), 'member', Date.now());
  return { id, username: clean, token };
}

/** Rotates a member's API token and returns the new one. */
export function resetToken(id: string): string {
  const token = randomBytes(32).toString('hex');
  db.prepare('UPDATE users SET token_hash = ? WHERE id = ?').run(sha(token), id);
  return token;
}

export function deleteUser(id: string): void {
  if (id === OWNER_ID) throw new Error('The owner cannot be deleted.');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function isOwnerId(id: string | null): boolean {
  return id === OWNER_ID;
}
