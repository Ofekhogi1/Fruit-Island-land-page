'use strict';

const express = require('express');

const config = require('../config');
const sessions = require('../lib/sessions');
const users = require('../lib/users');
const content = require('../lib/content');
const uploads = require('../lib/uploads');
const leads = require('../lib/leads');
const { SECTIONS } = require('../lib/schema');
const { createRateLimiter } = require('../lib/rateLimit');
const { validateStrength } = require('../lib/passwords');

const router = express.Router();

const loginLimiter = createRateLimiter({
  windowMs: config.login.windowMs,
  blockMs: config.login.lockoutMs,
  max: config.login.maxAttempts,
  keyGenerator: (req) => `ip:${sessions.clientIp(req)}`,
  message: 'יותר מדי ניסיונות התחברות. נסו שוב בעוד כמה דקות.'
});

const writeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => `w:${req.session?.userId || sessions.clientIp(req)}`
});

const publicUser = (session) => ({
  username: session.username,
  displayName: session.displayName,
  loggedInAt: new Date(session.createdAt).toISOString()
});

const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(sessions.clientIp(req));

/* ───────── התקנה ראשונית ───────── */

router.get('/setup', (req, res) => {
  res.json({
    needsSetup: !users.hasUsers(),
    allowed: isLoopback(req),
    /* בענן אין דיסק לכתיבה — המשתמש מוגדר דרך משתני סביבה */
    managed: config.isServerless
  });
});

router.post('/setup', loginLimiter.middleware, async (req, res, next) => {
  try {
    if (users.hasUsers()) return res.status(409).json({ error: 'כבר קיים משתמש ניהול' });
    if (!isLoopback(req)) {
      return res.status(403).json({ error: 'יצירת המשתמש הראשון אפשרית רק מהמחשב שעליו רץ השרת' });
    }
    const { username, password, displayName } = req.body || {};
    const weak = validateStrength(password);
    if (weak) return res.status(400).json({ error: weak });

    const user = await users.upsertUser(username, password, { displayName });
    const session = sessions.create(req, res, user);
    return res.status(201).json({ user: publicUser(session), csrfToken: session.csrf });
  } catch (error) {
    return next(error);
  }
});

/* ───────── התחברות ───────── */

router.post('/login', loginLimiter.middleware, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'שם משתמש וסיסמה נדרשים' });
    }
    const user = await users.authenticate(username, password);
    if (!user) {
      console.warn(`[auth] ניסיון התחברות שנכשל מ-${sessions.clientIp(req)}`);
      return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    }
    loginLimiter.reset(`ip:${sessions.clientIp(req)}`);
    const session = sessions.create(req, res, user);
    return res.json({ user: publicUser(session), csrfToken: session.csrf });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', (req, res) => {
  sessions.destroy(req, res);
  res.json({ ok: true });
});

router.get('/session', (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'לא מחובר' });
  return res.json({ user: publicUser(req.session), csrfToken: req.session.csrf });
});

/* ───────── מכאן והלאה: רק משתמש מחובר ───────── */

router.use(sessions.requireAuth, sessions.requireCsrf);

router.get('/schema', (req, res) => {
  res.json({ sections: SECTIONS, limits: config.uploads });
});

router.get('/content', async (req, res, next) => {
  try {
    return res.json({ content: await content.getContent() });
  } catch (error) {
    return next(error);
  }
});

router.put('/content', writeLimiter.middleware, async (req, res, next) => {
  try {
    const saved = await content.saveContent(req.body?.content, { username: req.session.username });
    return res.json({ ok: true, content: saved });
  } catch (error) {
    return next(error);
  }
});

router.post('/content/restore-defaults', writeLimiter.middleware, async (req, res, next) => {
  try {
    const saved = await content.restoreDefaults({ username: req.session.username });
    return res.json({ ok: true, content: saved });
  } catch (error) {
    return next(error);
  }
});

router.get('/backups', async (req, res, next) => {
  try {
    return res.json({ backups: await content.listBackups() });
  } catch (error) {
    return next(error);
  }
});

router.post('/backups/restore', writeLimiter.middleware, async (req, res, next) => {
  try {
    const saved = await content.restoreBackup(String(req.body?.name || ''), { username: req.session.username });
    return res.json({ ok: true, content: saved });
  } catch (error) {
    return next(error);
  }
});

/* ───────── מדיה ───────── */

router.get('/media', async (req, res, next) => {
  try {
    const [media, inUse] = await Promise.all([uploads.listMedia(), content.usedMediaPaths()]);
    return res.json({ media, inUse: [...inUse] });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/media',
  writeLimiter.middleware,
  (req, res, next) => {
    uploads.uploader.single('file')(req, res, (error) => {
      if (!error) return next();
      const message = error.code === 'LIMIT_FILE_SIZE' ? 'הקובץ גדול מדי' : error.message;
      return res.status(400).json({ error: message });
    });
  },
  async (req, res, next) => {
    try {
      const file = await uploads.finalize(req);
      return res.status(201).json({ ok: true, file });
    } catch (error) {
      return next(error);
    }
  }
);

router.delete('/media', writeLimiter.middleware, async (req, res, next) => {
  try {
    const target = String(req.body?.path || '');
    const inUse = await content.usedMediaPaths();
    if (inUse.has(target) || inUse.has(target.replace(/^\.?\//, ''))) {
      return res.status(409).json({ error: 'הקובץ בשימוש בעמוד — החליפו אותו קודם ואז מחקו' });
    }
    await uploads.deleteMedia(target);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

/* ───────── פניות מהטופס ───────── */

router.get('/leads', async (req, res, next) => {
  try {
    return res.json({ leads: await leads.list({ limit: 200 }) });
  } catch (error) {
    return next(error);
  }
});

router.get('/leads.csv', async (req, res, next) => {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="fruit-island-leads-${stamp}.csv"`);
    return res.type('text/csv; charset=utf-8').send(leads.toCsv(await leads.list({ limit: 200 })));
  } catch (error) {
    return next(error);
  }
});

router.post('/leads/handled', writeLimiter.middleware, async (req, res, next) => {
  try {
    const lead = await leads.setHandled(String(req.body?.id || ''), Boolean(req.body?.handled));
    return res.json({ ok: true, lead });
  } catch (error) {
    return next(error);
  }
});

router.delete('/leads', writeLimiter.middleware, async (req, res, next) => {
  try {
    await leads.remove(String(req.body?.id || ''));
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

/* ───────── סיסמה ───────── */

router.post('/password', writeLimiter.middleware, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const user = await users.authenticate(req.session.username, currentPassword);
    if (!user) return res.status(401).json({ error: 'הסיסמה הנוכחית שגויה' });

    const weak = validateStrength(newPassword);
    if (weak) return res.status(400).json({ error: weak });

    await users.upsertUser(user.username, newPassword, { displayName: user.displayName });
    // הסשנים חתומים מול טביעת האצבע של הסיסמה, ולכן כולם מתבטלים מאליהם
    sessions.destroy(req, res);
    return res.json({ ok: true, message: 'הסיסמה עודכנה — התחברו מחדש' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
