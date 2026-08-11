'use strict';

/**
 * שכבת אחסון אחת עם שני מימושים:
 *   • מערכת הקבצים — בפיתוח מקומי ובכל שרת עם דיסק קבוע.
 *   • Vercel Blob   — בענן, שם מערכת הקבצים היא לקריאה בלבד.
 * המפתחות זהים בשני המימושים: "data/..." לנתונים ו-"assets/..." למדיה.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const config = require('../config');

const KEY_RE = /^(data|assets)\/[A-Za-z0-9._\-/]+$/;

function assertKey(key) {
  const value = String(key || '');
  if (!KEY_RE.test(value) || value.includes('..')) throw new Error(`מפתח אחסון לא תקין: ${value}`);
  return value;
}

const trimSlash = (prefix) => String(prefix).replace(/\/+$/, '');

/* ───────────────────────── מערכת קבצים ───────────────────────── */

function fsPath(key) {
  assertKey(key);
  const base = key.startsWith('data/') ? path.join(config.paths.root, 'server') : config.paths.root;
  const target = path.resolve(base, key);
  if (!target.startsWith(path.resolve(base) + path.sep)) throw new Error('נתיב אחסון לא מורשה');
  return target;
}

const fsDriver = {
  remote: false,

  async readJson(key) {
    try {
      return JSON.parse(await fsp.readFile(fsPath(key), 'utf8'));
    } catch {
      return null;
    }
  },

  async writeJson(key, value) {
    const file = fsPath(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fsp.rename(tmp, file);
  },

  async list(prefix) {
    const dir = fsPath(trimSlash(prefix));
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      if (!/^[A-Za-z0-9._-]+$/.test(name) || name.endsWith('.tmp') || name.endsWith('.part')) continue;
      const stat = await fsp.stat(path.join(dir, name)).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      const key = `${trimSlash(prefix)}/${name}`;
      out.push({ key, url: key, name, size: stat.size, uploadedAt: stat.mtime.toISOString() });
    }
    return out;
  },

  async putBinary(key, buffer) {
    const file = fsPath(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, buffer, { mode: 0o644 });
    return key;
  },

  async remove(key) {
    await fsp.unlink(fsPath(key)).catch(() => {});
  },

  async exists(key) {
    return fs.existsSync(fsPath(key));
  }
};

/* ───────────────────────── Vercel Blob ───────────────────────── */

function createBlobDriver() {
  const { put, del, list } = require('@vercel/blob');
  const token = config.blob.token;
  const urlCache = new Map();

  async function urlFor(key) {
    assertKey(key);
    if (urlCache.has(key)) return urlCache.get(key);
    const found = await list({ prefix: key, limit: 1000, token });
    const hit = found.blobs.find((blob) => blob.pathname === key);
    if (hit) urlCache.set(key, hit.url);
    return hit ? hit.url : null;
  }

  return {
    remote: true,

    async readJson(key) {
      const url = await urlFor(key);
      if (!url) return null;
      // עוקפים את מטמון ה-CDN כדי לא לקרוא גרסה ישנה אחרי שמירה
      const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return null;
      try {
        return await response.json();
      } catch {
        return null;
      }
    },

    async writeJson(key, value) {
      assertKey(key);
      const result = await put(key, JSON.stringify(value, null, 2), {
        access: 'public',
        token,
        contentType: 'application/json; charset=utf-8',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0
      });
      urlCache.set(key, result.url);
    },

    async list(prefix) {
      const found = await list({ prefix: trimSlash(prefix) + '/', limit: 1000, token });
      return found.blobs.map((blob) => {
        urlCache.set(blob.pathname, blob.url);
        return {
          key: blob.pathname,
          url: blob.url,
          name: blob.pathname.split('/').pop(),
          size: blob.size,
          uploadedAt: new Date(blob.uploadedAt).toISOString()
        };
      });
    },

    async putBinary(key, buffer, contentType) {
      assertKey(key);
      const result = await put(key, buffer, {
        access: 'public',
        token,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true
      });
      urlCache.set(key, result.url);
      return result.url;
    },

    async remove(key) {
      const url = await urlFor(key);
      if (!url) return;
      await del(url, { token }).catch(() => {});
      urlCache.delete(key);
    },

    async exists(key) {
      return Boolean(await urlFor(key));
    }
  };
}

const driver = config.blob.enabled ? createBlobDriver() : fsDriver;

module.exports = {
  remote: driver.remote,
  readJson: (key) => driver.readJson(key),
  writeJson: (key, value) => driver.writeJson(key, value),
  list: (prefix) => driver.list(prefix),
  putBinary: (key, buffer, contentType) => driver.putBinary(key, buffer, contentType),
  remove: (key) => driver.remove(key),
  exists: (key) => driver.exists(key)
};
