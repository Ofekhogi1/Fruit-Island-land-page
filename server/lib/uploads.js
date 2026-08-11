'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const config = require('../config');

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.paths.tmpUploads),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.part`)
});

const uploader = multer({
  storage,
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

  const cleanup = async () => {
    await fsp.unlink(file.path).catch(() => {});
  };

  try {
    if (file.size > settings.maxBytes) {
      throw new UploadError(`הקובץ גדול מדי — עד ${Math.round(settings.maxBytes / (1024 * 1024))}MB`);
    }

    const handle = await fsp.open(file.path, 'r');
    const head = Buffer.alloc(64);
    await handle.read(head, 0, 64, 0);
    await handle.close();

    const ext = sniff(head);
    if (!ext || !allowed[ext]) {
      throw new UploadError('תוכן הקובץ לא תואם לסוג קובץ מותר');
    }

    const name = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const target = path.join(settings.dir, name);
    if (!target.startsWith(settings.dir + path.sep)) throw new UploadError('נתיב יעד לא תקין');

    await fsp.rename(file.path, target);
    await fsp.chmod(target, 0o644).catch(() => {});

    return {
      path: `${settings.publicBase}/${name}`,
      name,
      size: file.size,
      type: allowed[ext],
      kind
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function listMedia() {
  const collect = (kind) => {
    const settings = config.uploads[kind];
    if (!fs.existsSync(settings.dir)) return [];
    return fs
      .readdirSync(settings.dir)
      .filter((name) => /^[A-Za-z0-9._-]+$/.test(name) && !name.endsWith('.part'))
      .map((name) => {
        const stat = fs.statSync(path.join(settings.dir, name));
        return {
          kind,
          name,
          path: `${settings.publicBase}/${name}`,
          size: stat.size,
          uploadedAt: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  };
  return [...collect('image'), ...collect('video')];
}

async function deleteMedia(publicPath) {
  const normalized = String(publicPath || '').replace(/^\.?\//, '');
  const entry = Object.values(config.uploads).find((settings) => normalized.startsWith(`${settings.publicBase}/`));
  if (!entry) throw new UploadError('אפשר למחוק רק קבצים שהועלו דרך הפאנל');

  const name = path.basename(normalized);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new UploadError('שם קובץ לא תקין');

  const target = path.resolve(entry.dir, name);
  if (!target.startsWith(path.resolve(entry.dir) + path.sep)) throw new UploadError('נתיב לא מורשה');
  if (!fs.existsSync(target)) throw new UploadError('הקובץ לא נמצא');

  await fsp.unlink(target);
}

/** ניקוי שאריות העלאות שנקטעו */
function cleanTmp() {
  if (!fs.existsSync(config.paths.tmpUploads)) return;
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const name of fs.readdirSync(config.paths.tmpUploads)) {
    const file = path.join(config.paths.tmpUploads, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    } catch {
      /* מתעלמים */
    }
  }
}

module.exports = { uploader, finalize, listMedia, deleteMedia, cleanTmp, UploadError };
