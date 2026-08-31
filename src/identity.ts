import type { Context } from 'hono';
import { bearer, sessionCookieUser } from './auth.ts';
import * as users from './users.ts';

/**
 * Ties the cookie and token primitives in auth.ts to the users table. Kept in
 * its own module so auth.ts stays free of a users import and there is no import
 * cycle. Everything that needs to know "who is this request" imports from here.
 */

/** The signed-in user's id, or null. Validates the cookie AND that the user still exists. */
export function currentUserId(c: Context): string | null {
  const id = sessionCookieUser(c);
  return id && users.byId(id) ? id : null;
}

/** True if any user is signed in. Kept named isOwner so existing call sites read the same. */
export function isOwner(c: Context): boolean {
  return currentUserId(c) !== null;
}

/** True only for the owner account (used to gate account management). */
export function isOwnerUser(c: Context): boolean {
  return users.isOwnerId(currentUserId(c));
}

/** The user id behind an API bearer token, or null. */
export function apiUserId(c: Context): string | null {
  const token = bearer(c.req.header('authorization'));
  return token ? users.byToken(token) : null;
}

/** Convenience for routes that only gate, not scope. */
export function isApiAuthed(c: Context): boolean {
  return apiUserId(c) !== null;
}
