'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const KEY_LEN = 64;
const SCRYPT_OPTS = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 2 ** 15 * 8 * 2 };

const MIN_LENGTH = 12;

/** דרישות סיסמה מינימליות לחשבון ניהול */
function validateStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `הסיסמה חייבת להכיל לפחות ${MIN_LENGTH} תווים`;
  }
  if (password.length > 200) return 'הסיסמה ארוכה מדי';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    return 'הסיסמה חייבת לשלב לפחות שלושה סוגים: אותיות קטנות, אותיות גדולות, ספרות וסימנים';
  }
  return null;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, SCRYPT_OPTS);
  return ['scrypt', SCRYPT_OPTS.N, SCRYPT_OPTS.r, SCRYPT_OPTS.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  let derived;
  try {
    derived = await scrypt(String(password).normalize('NFKC'), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(N) * Number(r) * 2
    });
  } catch {
    return false;
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword, validateStrength, MIN_LENGTH };
