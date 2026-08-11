'use strict';

const fs = require('fs');

const config = require('../config');
const storage = require('./storage');
const { SECTIONS, MAX_TEXT, MAX_LIST_ITEMS } = require('./schema');

const SAFE_MEDIA = /^assets\/(images|video)\/[A-Za-z0-9._\-/]+$/;
/* קבצים שהועלו ל-Vercel Blob מוגשים מכתובת מלאה על ה-CDN שלהם */
const BLOB_MEDIA = new RegExp(
  `^https://[a-z0-9-]+\\.${config.blob.host.replace(/\./g, '\\.')}/assets/(images|video)/[A-Za-z0-9._\\-/]+$`,
  'i'
);

const isMediaPath = (value) => SAFE_MEDIA.test(value) || BLOB_MEDIA.test(value);

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

const cleanText = (value, { multiline = false, max = MAX_TEXT } = {}) => {
  let text = String(value ?? '').replace(CONTROL_CHARS, '');
  text = multiline ? text.replace(/\r\n/g, '\n') : text.replace(/\s+/g, ' ');
  text = text.trim();
  return text.slice(0, Math.min(max, MAX_TEXT));
};

function cleanMedia(value, field) {
  const raw = cleanText(value, { max: 500 });
  if (!raw) return '';
  if (BLOB_MEDIA.test(raw)) return raw;
  const normalized = raw.replace(/^\.?\//, '');
  if (normalized.includes('..') || !SAFE_MEDIA.test(normalized)) {
    throw new ValidationError(`נתיב קובץ לא תקין בשדה "${field.label}"`);
  }
  return normalized;
}

function cleanUrl(value, field) {
  const raw = cleanText(value, { max: 500 });
  if (!raw) return '';
  if (raw.startsWith('#') || isMediaPath(raw.replace(/^\.?\//, ''))) return raw;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`כתובת לא תקינה בשדה "${field.label}"`);
  }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
    throw new ValidationError(`כתובת לא מורשית בשדה "${field.label}" — מותר רק http, https, mailto או tel`);
  }
  return parsed.toString();
}

function cleanField(field, value) {
  switch (field.type) {
    case 'text':
      return cleanText(value, { max: field.max || 200 });
    case 'textarea':
      return cleanText(value, { multiline: true, max: field.max || 1000 });
    case 'url':
      return cleanUrl(value, field);
    case 'image':
    case 'video':
      return cleanMedia(value, field);
    case 'tel': {
      const text = cleanText(value, { max: field.max || 30 });
      if (text && !/^[0-9+\-()\s]{5,30}$/.test(text)) {
        throw new ValidationError(`מספר טלפון לא תקין בשדה "${field.label}"`);
      }
      return text;
    }
    case 'email': {
      const text = cleanText(value, { max: field.max || 120 });
      if (text && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) {
        throw new ValidationError(`כתובת אימייל לא תקינה בשדה "${field.label}"`);
      }
      return text;
    }
    case 'list': {
      if (!Array.isArray(value)) return [];
      const limit = Math.min(field.maxItems || MAX_LIST_ITEMS, MAX_LIST_ITEMS);
      return value
        .slice(0, limit)
        .map((item) => cleanText(item, { max: field.max || 200 }))
        .filter(Boolean);
    }
    case 'repeater': {
      if (!Array.isArray(value)) return [];
      const limit = Math.min(field.maxItems || MAX_LIST_ITEMS, MAX_LIST_ITEMS);
      return value.slice(0, limit).map((item) => {
        const out = {};
        for (const sub of field.fields) {
          out[sub.key] = cleanField(sub, item && typeof item === 'object' ? item[sub.key] : undefined);
        }
        return out;
      });
    }
    default:
      throw new ValidationError(`סוג שדה לא נתמך: ${field.type}`);
  }
}

/** מנקה ומאמת אובייקט תוכן שלם מול הסכימה — מפתחות לא מוכרים נזרקים */
function sanitizeContent(input) {
  const source = input && typeof input === 'object' ? input : {};
  const output = {};
  for (const section of SECTIONS) {
    const raw = source[section.id] && typeof source[section.id] === 'object' ? source[section.id] : {};
    const clean = {};
    for (const field of section.fields) {
      clean[field.key] = cleanField(field, raw[field.key]);
    }
    output[section.id] = clean;
  }
  return output;
}

const CONTENT_KEY = 'data/content.json';
const BACKUP_PREFIX = 'data/backups';
const CACHE_TTL_MS = 30 * 1000;

/** ברירת המחדל נקראת מהקוד עצמו — קובץ לקריאה בלבד שנארז יחד עם השרת */
function readDefaults() {
  try {
    return JSON.parse(fs.readFileSync(config.paths.defaultContentFile, 'utf8'));
  } catch {
    return {};
  }
}

let cache = null;
let cacheAt = 0;

async function getContent() {
  // באחסון מרוחק מרעננים מדי פעם, כי מופע אחר עלול לשמור תוכן חדש
  if (cache && (!storage.remote || Date.now() - cacheAt < CACHE_TTL_MS)) return cache;
  const stored = await storage.readJson(CONTENT_KEY);
  cache = sanitizeContent(stored || readDefaults());
  cacheAt = Date.now();
  return cache;
}

async function pruneBackups(keep = 20) {
  const keys = (await storage.list(BACKUP_PREFIX)).map((entry) => entry.key).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - keep))) {
    await storage.remove(key);
  }
}

async function saveContent(input, meta = {}) {
  const clean = sanitizeContent(input);

  const previous = await storage.readJson(CONTENT_KEY);
  if (previous) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await storage.writeJson(`${BACKUP_PREFIX}/content-${stamp}.json`, previous).catch(() => {});
    await pruneBackups().catch(() => {});
  }

  await storage.writeJson(CONTENT_KEY, clean);

  cache = clean;
  cacheAt = Date.now();
  if (meta.username) {
    console.log(`[content] נשמר ע"י ${meta.username} בשעה ${new Date().toISOString()}`);
  }
  return clean;
}

async function restoreDefaults(meta) {
  return saveContent(readDefaults(), meta);
}

async function listBackups() {
  const entries = await storage.list(BACKUP_PREFIX);
  return entries
    .filter((entry) => /^content-.*\.json$/.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, 20)
    .map((entry) => ({ name: entry.name, savedAt: entry.uploadedAt }));
}

async function restoreBackup(name, meta) {
  if (!/^content-[A-Za-z0-9\-]+\.json$/.test(name)) throw new ValidationError('שם גיבוי לא תקין');
  const data = await storage.readJson(`${BACKUP_PREFIX}/${name}`);
  if (!data) throw new ValidationError('הגיבוי לא נמצא');
  return saveContent(data, meta);
}

/** נתיבי מדיה שנמצאים בשימוש — כדי למנוע מחיקה של קובץ פעיל */
async function usedMediaPaths() {
  const used = new Set();
  const walk = (value) => {
    if (typeof value === 'string') {
      if (isMediaPath(value)) used.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(await getContent());
  return used;
}

module.exports = {
  getContent,
  saveContent,
  restoreDefaults,
  listBackups,
  restoreBackup,
  sanitizeContent,
  usedMediaPaths,
  ValidationError
};
