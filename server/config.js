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

/* על Vercel מערכת הקבצים לקריאה בלבד והאחסון עובר ל-Vercel Blob */
const blobToken = process.env.BLOB_READ_WRITE_TOKEN || '';
const isServerless = Boolean(process.env.VERCEL);

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
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* מערכת קבצים לקריאה בלבד — האחסון מגיע מ-Blob */
  }
}

/* גבול גוף הבקשה של פונקציות Vercel הוא 4.5MB — מגבילים מתחתיו כדי להחזיר שגיאה ברורה */
const maxImageBytes = isServerless ? 4 * 1024 * 1024 : 8 * 1024 * 1024;
const maxVideoBytes = isServerless ? 4 * 1024 * 1024 : 80 * 1024 * 1024;

module.exports = {
  isProduction,
  isServerless,
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '0.0.0.0',
  trustProxy: truthy(process.env.TRUST_PROXY) || isServerless,
  forceSecureCookie: truthy(process.env.FORCE_SECURE_COOKIE) || isServerless,
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, ''),
  paths,

  blob: {
    token: blobToken,
    enabled: Boolean(blobToken),
    /* מארח ה-CDN של Blob — נדרש ל-CSP ולאימות נתיבי מדיה */
    host: 'public.blob.vercel-storage.com'
  },

  /* סוד לחתימת עוגיות סשן. בענן חייבים ערך קבוע, אחרת כל מופע יחתום אחרת */
  sessionSecret: process.env.SESSION_SECRET || '',

  /* משתמש ניהול ממשתני סביבה — הדרך היחידה לאחסן פרטי התחברות ללא דיסק */
  envAdmin: {
    username: (process.env.ADMIN_USERNAME || '').trim().toLowerCase(),
    passwordHash: (process.env.ADMIN_PASSWORD_HASH || '').trim(),
    displayName: process.env.ADMIN_DISPLAY_NAME || ''
  },

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
      maxBytes: maxImageBytes,
      dir: paths.imageUploads,
      publicBase: 'assets/images/uploads'
    },
    video: {
      maxBytes: maxVideoBytes,
      dir: paths.videoUploads,
      publicBase: 'assets/video/uploads'
    }
  }
};
