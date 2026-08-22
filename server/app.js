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
const seo = require('./lib/seo');
const leads = require('./lib/leads');
const { createRateLimiter } = require('./lib/rateLimit');
const adminRoutes = require('./routes/admin');

/* ───────── ביטול מטמון לפי תוכן הקובץ ─────────
   index.html מוגש עם no-cache, ולכן הזרקת ?v=<hash> לכתובות הנכסים
   גורמת לכל שינוי בקובץ לייצר כתובת חדשה — הדפדפן מוריד אותה מיד
   במקום להגיש גרסה ישנה מהמטמון. */
const ASSET_URL = /(\s(?:href|src)=")(assets\/[^"?]+)(")/g;
const versionCache = new Map();

function assetVersion(rel) {
  if (versionCache.has(rel)) return versionCache.get(rel);
  let v = null;
  try {
    const buf = fs.readFileSync(path.join(config.paths.root, rel));
    v = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
  } catch {
    /* קובץ חסר — משאירים את הכתובת כמו שהיא */
  }
  if (config.isProduction) versionCache.set(rel, v);
  return v;
}

let templateCache = null;

/** ה-HTML עם חותמות הגרסה. זהה לכל הבקשות, ולכן נבנה פעם אחת בייצור. */
function template() {
  if (templateCache) return templateCache;
  const html = fs.readFileSync(path.join(config.paths.root, 'index.html'), 'utf8');
  const out = html.replace(ASSET_URL, (match, head, rel, tail) => {
    const v = assetVersion(rel);
    return v ? `${head}${rel}?v=${v}${tail}` : match;
  });
  if (config.isProduction) templateCache = out;
  return out;
}

/* נגן הווידאו ב-Hero מוזן מפאנל הניהול. כל עוד לא הוגדר סרטון, האלמנט
   נשאר ריק ללא שום תועלת — עדיף להסיר אותו מה-HTML שנשלח. */
const HERO_VIDEO = /\s*<video class="hero__video"[\s\S]*?<\/video>/i;

function renderPage(data, nonce) {
  let html = template();
  if (!(data && data.hero && data.hero.video)) html = html.replace(HERO_VIDEO, '');
  return seo.applyHead(html, data, nonce);
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  /* מדיה שהועלתה דרך הפאנל מוגשת מה-CDN של Vercel Blob */
  const blobOrigin = `https://*.${config.blob.host}`;

  /* nonce לכל בקשה — ה-JSON-LD נבנה מהתוכן ולכן אין לו גיבוב קבוע מראש */
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

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
          'script-src': ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': ["'self'", 'data:', 'blob:', blobOrigin],
          'media-src': ["'self'", 'blob:', blobOrigin],
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

  app.get('/api/content', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-cache');
      return res.json({ content: await content.getContent() });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  /* ───────── פניות מטופס "הצעה לאירוע" ─────────
     הפנייה נשמרת אצלנו לפני כל דבר אחר. הקישור לוואטסאפ נשאר בעמוד
     כאפשרות המשך, אבל הוא כבר לא התנאי לכך שהפנייה תגיע אלינו. */

  const leadLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 8,
    keyGenerator: (req) => `lead:${sessions.clientIp(req)}`,
    message: 'נשלחו כבר כמה פניות מהמכשיר הזה. נסו שוב בעוד כמה דקות או שלחו לנו וואטסאפ.'
  });

  app.post('/api/lead', leadLimiter.middleware, async (req, res, next) => {
    try {
      /* מלכודת הבוטים של הטופס. עונים "התקבל" כדי לא ללמד את הבוט מה נכשל. */
      if (String((req.body && req.body.company) || '').trim() !== '') {
        return res.status(202).json({ ok: true });
      }
      const lead = await leads.add(req.body);
      return res.status(201).json({ ok: true, id: lead.id });
    } catch (error) {
      return next(error);
    }
  });

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
      setHeaders: (res) => {
        res.set('X-Content-Type-Options', 'nosniff');
        if (!config.isProduction) return res.set('Cache-Control', 'no-store');
        /* כתובת עם ?v=<hash> ייחודית לתוכן — אפשר לשמור אותה לנצח.
           בלי חותמת, הדפדפן מאמת מחדש כדי שהחלפת קובץ באותו שם תתפוס. */
        return res.set(
          'Cache-Control',
          res.req && res.req.query && res.req.query.v
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=300, stale-while-revalidate=86400'
        );
      }
    })
  );

  app.get('/robots.txt', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res
      .type('text/plain')
      .send(
        `User-agent: *\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${seo.origin()}/sitemap.xml\n`
      );
  });

  app.get('/sitemap.xml', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(seo.sitemap());
  });

  app.get('/', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-cache');
      const data = await content.getContent();
      return res.type('html').send(renderPage(data, res.locals.cspNonce));
    } catch (error) {
      return next(error);
    }
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

  return app;
}

module.exports = { createApp };
