'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

/* טעינת .env בסיסית — ללא תלות חיצונית */
(function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const isProduction = process.env.NODE_ENV === 'production';
const truthy = (value) => value === '1' || value === 'true' || value === 'yes';

const paths = {
  root: ROOT,
  assets: path.join(ROOT, 'assets'),
  admin: path.join(ROOT, 'admin'),
  data: path.join(ROOT, 'server', 'data'),
  backups: path.join(ROOT, 'server', 'data', 'backups'),
  usersFile: path.join(ROOT, 'server', 'data', 'users.json'),
  contentFile: path.join(ROOT, 'server', 'data', 'content.json'),
  defaultContentFile: path.join(ROOT, 'server', 'data', 'content.default.json'),
  imageUploads: path.join(ROOT, 'assets', 'images', 'uploads'),
  videoUploads: path.join(ROOT, 'assets', 'video', 'uploads'),
  tmpUploads: path.join(ROOT, 'server', 'data', 'tmp')
};

for (const dir of [paths.data, paths.backups, paths.imageUploads, paths.videoUploads, paths.tmpUploads]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  isProduction,
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '0.0.0.0',
  trustProxy: truthy(process.env.TRUST_PROXY),
  forceSecureCookie: truthy(process.env.FORCE_SECURE_COOKIE),
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, ''),
  paths,

  session: {
    cookieName: 'fi_sid',
    csrfCookieName: 'fi_csrf',
    absoluteTtlMs: 12 * 60 * 60 * 1000, // תוקף מוחלט
    idleTtlMs: 2 * 60 * 60 * 1000       // ניתוק לאחר חוסר פעילות
  },

  login: {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000,
    lockoutMs: 15 * 60 * 1000
  },

  uploads: {
    image: {
      maxBytes: 8 * 1024 * 1024,
      dir: paths.imageUploads,
      publicBase: 'assets/images/uploads'
    },
    video: {
      maxBytes: 80 * 1024 * 1024,
      dir: paths.videoUploads,
      publicBase: 'assets/video/uploads'
    }
  }
};
