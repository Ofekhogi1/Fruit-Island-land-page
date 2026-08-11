'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const config = require('../config');
const { hashPassword, verifyPassword } = require('./passwords');

const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** בענן אין דיסק לכתיבה, ולכן פרטי ההתחברות מגיעים ממשתני סביבה */
const envMode = () => Boolean(config.envAdmin.username && config.envAdmin.passwordHash);

function envUser() {
  const username = config.envAdmin.username;
  return {
    id: crypto.createHash('sha256').update(`env:${username}`).digest('hex').slice(0, 32),
    username,
    displayName: config.envAdmin.displayName || username,
    password: config.envAdmin.passwordHash,
    createdAt: null,
    passwordChangedAt: null
  };
}

function readUsers() {
  if (envMode()) return [envUser()];
  try {
    const raw = fs.readFileSync(config.paths.usersFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  const tmp = `${config.paths.usersFile}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ users }, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, config.paths.usersFile);
  await fsp.chmod(config.paths.usersFile, 0o600).catch(() => {});
}

function hasUsers() {
  return readUsers().length > 0;
}

function findById(id) {
  return readUsers().find((user) => user.id === id) || null;
}

/** מזהה יציב לסיסמה הנוכחית — משמש לביטול סשנים לאחר החלפת סיסמה */
function credentialFingerprint(username) {
  const normalized = String(username || '').trim().toLowerCase();
  const user = readUsers().find((candidate) => candidate.username === normalized);
  return user ? user.password : null;
}

/** אימות פרטי התחברות בזמן קבוע ככל האפשר — גם משתמש לא קיים עובר חישוב hash */
async function authenticate(username, password) {
  const users = readUsers();
  const normalized = String(username || '').trim().toLowerCase();
  const user = users.find((candidate) => candidate.username === normalized);
  const stored = user ? user.password : DUMMY_HASH;
  const ok = await verifyPassword(password, stored);
  return ok && user ? user : null;
}

async function upsertUser(username, password, { displayName } = {}) {
  if (envMode()) {
    const error = new Error(
      'פרטי ההתחברות מוגדרים במשתני הסביבה. כדי להחליף סיסמה הריצו "npm run admin:hash" והחליפו את ADMIN_PASSWORD_HASH.'
    );
    error.statusCode = 409;
    throw error;
  }
  const normalized = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) {
    throw new Error('שם המשתמש חייב להכיל 3–32 תווים באנגלית, ספרות או . _ -');
  }
  const users = readUsers();
  const hash = await hashPassword(password);
  const existing = users.find((user) => user.username === normalized);
  if (existing) {
    existing.password = hash;
    existing.passwordChangedAt = new Date().toISOString();
    if (displayName) existing.displayName = displayName;
  } else {
    users.push({
      id: crypto.randomUUID(),
      username: normalized,
      displayName: displayName || normalized,
      password: hash,
      createdAt: new Date().toISOString(),
      passwordChangedAt: new Date().toISOString()
    });
  }
  await writeUsers(users);
  return users.find((user) => user.username === normalized);
}

module.exports = {
  hasUsers,
  findById,
  authenticate,
  upsertUser,
  credentialFingerprint,
  envMode,
  usersFile: path.relative(config.paths.root, config.paths.usersFile)
};
