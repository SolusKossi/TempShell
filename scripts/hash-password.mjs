#!/usr/bin/env node
// Usage: node scripts/hash-password.mjs 'your password'
// Prints the OWNER_PASSWORD_HASH value. The password itself is never stored.
import { randomBytes, scryptSync } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs 'your password'");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log(`scrypt:${salt.toString('hex')}:${hash.toString('hex')}`);
