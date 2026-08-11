'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const config = require('../config');
const { SECTIONS, MAX_TEXT, MAX_LIST_ITEMS } = require('./schema');

const SAFE_MEDIA = /^assets\/(images|video)\/[A-Za-z0-9._\-/]+$/;
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
  const raw = cleanText(value, { max: 300 });
  if (!raw) return '';
  const normalized = raw.replace(/^\.?\//, '');
  if (normalized.includes('..') || !SAFE_MEDIA.test(normalized)) {
    throw new ValidationError(`נתיב קובץ לא תקין בשדה "${field.label}"`);
  }
  return normalized;
}

function cleanUrl(value, field) {
  const raw = cleanText(value, { max: 500 });
  if (!raw) return '';
  if (raw.startsWith('#') || SAFE_MEDIA.test(raw.replace(/^\.?\//, ''))) return raw;
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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

let cache = null;

function loadDefaults() {
  return readJson(config.paths.defaultContentFile) || {};
}

function getContent() {
  if (cache) return cache;
  const stored = readJson(config.paths.contentFile);
  cache = sanitizeContent(stored || loadDefaults());
  return cache;
}

async function pruneBackups(keep = 20) {
  const files = (await fsp.readdir(config.paths.backups)).filter((name) => name.endsWith('.json')).sort();
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    await fsp.unlink(path.join(config.paths.backups, name)).catch(() => {});
  }
}

async function saveContent(input, meta = {}) {
  const clean = sanitizeContent(input);
  const serialized = JSON.stringify(clean, null, 2);

  if (fs.existsSync(config.paths.contentFile)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp
      .copyFile(config.paths.contentFile, path.join(config.paths.backups, `content-${stamp}.json`))
      .catch(() => {});
    await pruneBackups();
  }

  const tmp = `${config.paths.contentFile}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tmp, serialized, 'utf8');
  await fsp.rename(tmp, config.paths.contentFile);

  cache = clean;
  if (meta.username) {
    console.log(`[content] נשמר ע"י ${meta.username} בשעה ${new Date().toISOString()}`);
  }
  return clean;
}

async function restoreDefaults(meta) {
  return saveContent(loadDefaults(), meta);
}

function listBackups() {
  return fs
    .readdirSync(config.paths.backups)
    .filter((name) => /^content-.*\.json$/.test(name))
    .sort()
    .reverse()
    .slice(0, 20)
    .map((name) => ({
      name,
      savedAt: fs.statSync(path.join(config.paths.backups, name)).mtime.toISOString()
    }));
}

async function restoreBackup(name, meta) {
  if (!/^content-[A-Za-z0-9\-]+\.json$/.test(name)) throw new ValidationError('שם גיבוי לא תקין');
  const file = path.join(config.paths.backups, name);
  if (!file.startsWith(config.paths.backups + path.sep) || !fs.existsSync(file)) {
    throw new ValidationError('הגיבוי לא נמצא');
  }
  return saveContent(readJson(file) || {}, meta);
}

/** נתיבי מדיה שנמצאים בשימוש — כדי למנוע מחיקה של קובץ פעיל */
function usedMediaPaths() {
  const used = new Set();
  const walk = (value) => {
    if (typeof value === 'string') {
      if (SAFE_MEDIA.test(value)) used.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(getContent());
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
