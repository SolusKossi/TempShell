import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { config } from './config.ts';

const OWNER_COOKIE = 'owner';
const JOIN_COOKIE = 'join';
const OWNER_TTL_DAYS = 60;

/* ------------------------------------------------------------------ ids --- */

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/o/0/1, these get misread

export function generateId(length = 12): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return out;
}

/**
 * Four digits: the fastest thing to type on a strange PC.
 *
 * That is only 9000 possibilities, so the join endpoint is rate limited both
 * per IP and globally. Without those limits this would be trivially guessable.
 */
export function generateJoinCode(): string {
  return String(randomInt(1_000, 10_000));
}

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'session'}-${generateId(4)}`;
}

/* ------------------------------------------------------------ passwords --- */

/**
 * Format: scrypt:<saltHex>:<hashHex>
 *
 * Colon rather than the conventional dollar sign, because the hash lives in a
 * .env file and any shell that sources it would expand `$abc` as a variable and
 * silently corrupt the value.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

/** Pulls the bearer token out of an Authorization header, if present. */
export function bearer(header: string | undefined): string | null {
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

/* -------------------------------------------------------------- cookies --- */

function sign(value: string): string {
  const mac = createHmac('sha256', config.cookieSecret).update(value).digest('base64url');
  return `${value}.${mac}`;
}

function unsign(signed: string | undefined): string | null {
  if (!signed) return null;
  const index = signed.lastIndexOf('.');
  if (index < 1) return null;
  const value = signed.slice(0, index);
  const mac = Buffer.from(signed.slice(index + 1));
  const expected = Buffer.from(createHmac('sha256', config.cookieSecret).update(value).digest('base64url'));
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  return value;
}

/**
 * Scoping and transport security are separate questions. The cookie is shared
 * across subdomains whenever the domain has one to share (so one login covers
 * every tool), while Secure follows whether we are actually on HTTPS.
 */
// Single host, so a host-only cookie is correct, and safer than a wildcard.
const cookieDomain = undefined;

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

/** Signs the browser in as a given user id. The cookie carries id and expiry. */
export function grantSession(c: Context, userId: string): void {
  const expiresAt = Date.now() + OWNER_TTL_DAYS * 86_400_000;
  setCookie(c, OWNER_COOKIE, sign(`${userId}|${expiresAt}`), cookieOptions(OWNER_TTL_DAYS * 86_400));
}

export function revokeSession(c: Context): void {
  deleteCookie(c, OWNER_COOKIE, { path: '/', ...(cookieDomain ? { domain: cookieDomain } : {}) });
}

/** The user id from a valid, unexpired session cookie, if any. No existence check. */
export function sessionCookieUser(c: Context): string | null {
  const value = unsign(getCookie(c, OWNER_COOKIE));
  if (!value) return null;
  const sep = value.lastIndexOf('|');
  if (sep < 1) return null;
  const id = value.slice(0, sep);
  const expiry = Number(value.slice(sep + 1));
  return expiry > Date.now() ? id : null;
}

/**
 * A join grant is deliberately scoped to one session. Logging into your whole
 * account on a machine you are troubleshooting is exactly what we want to avoid.
 */
export function grantJoin(c: Context, sessionId: string): void {
  const existing = joinedSessions(c);
  existing.add(sessionId);
  setCookie(c, JOIN_COOKIE, sign([...existing].join(',')), cookieOptions(7 * 86_400));
}

export function joinedSessions(c: Context): Set<string> {
  const value = unsign(getCookie(c, JOIN_COOKIE));
  return new Set(value ? value.split(',').filter(Boolean) : []);
}

/** Whether this browser has joined a given session via its code. */
export function hasJoined(c: Context, sessionId: string): boolean {
  return joinedSessions(c).has(sessionId);
}

/**
 * Generic "this browser unlocked that thing" grant, used for password
 * protected drops. Same shape as a join: a signed list of ids, nothing else.
 */
export function grantScope(c: Context, name: string, id: string): void {
  const existing = scopeIds(c, name);
  existing.add(id);
  setCookie(c, name, sign([...existing].slice(-50).join(',')), cookieOptions(7 * 86_400));
}

export function scopeIds(c: Context, name: string): Set<string> {
  const value = unsign(getCookie(c, name));
  return new Set(value ? value.split(',').filter(Boolean) : []);
}

export function hasScope(c: Context, name: string, id: string): boolean {
  return scopeIds(c, name).has(id);
}

/* -------------------------------------------------------- rate limiting --- */

const attempts = new Map<string, { count: number; resetAt: number }>();

/** Crude but sufficient: join codes are six digits and must not be brute-forceable. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.resetAt < now) attempts.delete(key);
}, 60_000).unref();

export function clientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/**
 * Second line of defence for the short join codes. Per-IP limits alone do not
 * stop a distributed guesser, so the whole endpoint has a ceiling too. Wrong
 * guesses count; correct ones do not.
 */
const wrongGuesses = { count: 0, resetAt: 0 };

export function joinBudgetAvailable(): boolean {
  const now = Date.now();
  if (wrongGuesses.resetAt < now) {
    wrongGuesses.count = 0;
    wrongGuesses.resetAt = now + 3_600_000;
  }
  return wrongGuesses.count < 60;
}

export function recordWrongGuess(): void {
  wrongGuesses.count++;
}
