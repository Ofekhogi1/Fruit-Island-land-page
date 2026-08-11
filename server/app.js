'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const config = require('./config');
const sessions = require('./lib/sessions');
const content = require('./lib/content');
const users = require('./lib/users');
const uploads = require('./lib/uploads');
const adminRoutes = require('./routes/admin');

/** גיבוב סקריפטים מוטבעים (JSON-LD) כדי לשמור על CSP קשיח ללא unsafe-inline */
function inlineScriptHashes(file) {
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, 'utf8');
  const hashes = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const digest = crypto.createHash('sha256').update(match[1], 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  const scriptHashes = inlineScriptHashes(path.join(config.paths.root, 'index.html'));

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'base-uri': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
          'script-src': ["'self'", ...scriptHashes],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'connect-src': ["'self'"],
          'manifest-src': ["'self'"],
          ...(config.isProduction ? { 'upgrade-insecure-requests': [] } : {})
        }
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false
    })
  );
  app.use(helmet.crossOriginResourcePolicy({ policy: 'same-site' }));
  app.use((req, res, next) => {
    res.set('X-Robots-Tag', req.path.startsWith('/admin') ? 'noindex, nofollow' : 'all');
    res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    next();
  });

  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(sessions.attach);

  /* ───────── API ציבורי ───────── */

  app.get('/api/content', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ content: content.getContent() });
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  /* ───────── API ניהול ───────── */

  app.use('/api/admin', adminRoutes);

  /* ───────── פאנל הניהול ───────── */

  const noStore = (res) => res.set('Cache-Control', 'no-store, max-age=0');

  app.use(
    '/admin/assets',
    express.static(path.join(config.paths.admin, 'assets'), {
      dotfiles: 'deny',
      index: false,
      setHeaders: (res) => res.set('Cache-Control', 'no-store')
    })
  );

  app.get('/admin/login', (req, res) => {
    noStore(res);
    if (req.session) return res.redirect('/admin');
    return res.sendFile(path.join(config.paths.admin, 'login.html'));
  });

  app.get('/admin/setup', (req, res) => {
    noStore(res);
    if (users.hasUsers()) return res.redirect('/admin/login');
    return res.sendFile(path.join(config.paths.admin, 'setup.html'));
  });

  app.get(['/admin', '/admin/*'], (req, res) => {
    noStore(res);
    if (!users.hasUsers()) return res.redirect('/admin/setup');
    if (!req.session) return res.redirect('/admin/login');
    return res.sendFile(path.join(config.paths.admin, 'index.html'));
  });

  /* ───────── האתר עצמו (רשימת היתר בלבד) ───────── */

  app.use(
    '/assets',
    express.static(config.paths.assets, {
      dotfiles: 'deny',
      index: false,
      redirect: false,
      maxAge: config.isProduction ? '7d' : 0,
      setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff')
    })
  );

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /api/\n');
  });

  app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.paths.root, 'index.html'));
  });

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'לא נמצא' });
    return res.status(404).type('text/plain').send('404 — הדף לא נמצא');
  });

  /* ───────── טיפול בשגיאות ───────── */

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number(error.statusCode) || 500;
    if (status >= 500) console.error('[error]', error);
    return res.status(status).json({
      error: status >= 500 ? 'שגיאת שרת — נסו שוב' : error.message
    });
  });

  uploads.cleanTmp();
  setInterval(() => uploads.cleanTmp(), 60 * 60 * 1000).unref();

  return app;
}

module.exports = { createApp };
