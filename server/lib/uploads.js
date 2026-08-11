'use strict';

const crypto = require('crypto');
const multer = require('multer');

const config = require('../config');
const storage = require('./storage');

const IMAGE_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif'
};

const VIDEO_TYPES = {
  mp4: 'video/mp4',
  webm: 'video/webm'
};

/** זיהוי סוג הקובץ לפי החתימה הבינארית — לא סומכים על שם הקובץ או על ה-MIME שהלקוח שלח */
function sniff(buffer) {
  const startsWith = (bytes, offset = 0) => bytes.every((byte, i) => buffer[offset + i] === byte);
  const ascii = (offset, length) => buffer.slice(offset, offset + length).toString('latin1');

  if (startsWith([0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (startsWith([0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4).toLowerCase();
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'avif';
    if (['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'm4v ', 'dash'].includes(brand)) return 'mp4';
    return 'mp4';
  }
  return null;
}

function kindOf(req) {
  return req.query.kind === 'video' ? 'video' : 'image';
}

/* שומרים בזיכרון ולא בדיסק — בענן אין תיקייה לכתיבה */
const uploader = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fields: 4,
    fieldNameSize: 64,
    fileSize: config.uploads.video.maxBytes
  },
  fileFilter: (req, file, cb) => {
    const kind = kindOf(req);
    const allowed = kind === 'video' ? VIDEO_TYPES : IMAGE_TYPES;
    const mime = String(file.mimetype || '').toLowerCase();
    if (!Object.values(allowed).includes(mime)) {
      cb(new UploadError(`סוג קובץ לא נתמך. מותר: ${Object.keys(allowed).join(', ')}`));
      return;
    }
    cb(null, true);
  }
});

class UploadError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

async function finalize(req) {
  const file = req.file;
  if (!file) throw new UploadError('לא נבחר קובץ');

  const kind = kindOf(req);
  const settings = config.uploads[kind];
  const allowed = kind === 'video' ? VIDEO_TYPES : IMAGE_TYPES;

  if (file.size > settings.maxBytes) {
    throw new UploadError(`הקובץ גדול מדי — עד ${Math.round(settings.maxBytes / (1024 * 1024))}MB`);
  }

  const ext = sniff(file.buffer.subarray(0, 64));
  if (!ext || !allowed[ext]) {
    throw new UploadError('תוכן הקובץ לא תואם לסוג קובץ מותר');
  }

  const name = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const key = `${settings.publicBase}/${name}`;
  const location = await storage.putBinary(key, file.buffer, allowed[ext]);

  return {
    path: location,
    name,
    size: file.size,
    type: allowed[ext],
    kind
  };
}

async function listMedia() {
  const groups = await Promise.all(
    Object.keys(config.uploads).map(async (kind) => {
      const entries = await storage.list(config.uploads[kind].publicBase);
      return entries.map((entry) => ({
        kind,
        name: entry.name,
        path: entry.url,
        size: entry.size,
        uploadedAt: entry.uploadedAt
      }));
    })
  );
  return groups.flat().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** ממיר נתיב ציבורי — יחסי או כתובת Blob מלאה — למפתח אחסון מאומת */
function storageKeyFor(publicPath) {
  let value = String(publicPath || '').trim();

  if (/^https?:\/\//i.test(value)) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new UploadError('נתיב לא תקין');
    }
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith(`.${config.blob.host}`)) {
      throw new UploadError('אפשר למחוק רק קבצים שהועלו דרך הפאנל');
    }
    value = parsed.pathname.replace(/^\//, '');
  } else {
    value = value.replace(/^\.?\//, '');
  }

  const settings = Object.values(config.uploads).find((entry) => value.startsWith(`${entry.publicBase}/`));
  if (!settings) throw new UploadError('אפשר למחוק רק קבצים שהועלו דרך הפאנל');

  const name = value.slice(settings.publicBase.length + 1);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new UploadError('שם קובץ לא תקין');

  return `${settings.publicBase}/${name}`;
}

async function deleteMedia(publicPath) {
  const key = storageKeyFor(publicPath);
  if (!(await storage.exists(key))) throw new UploadError('הקובץ לא נמצא');
  await storage.remove(key);
}

module.exports = { uploader, finalize, listMedia, deleteMedia, UploadError };
