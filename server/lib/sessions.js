'use strict';

const crypto = require('crypto');
const config = require('../config');

const users = require('./users');

/**
 * סשנים חסרי מצב: כל הנתונים יושבים בעוגייה חתומה ב-HMAC-SHA256.
 * זה מה שמאפשר לפאנל לעבוד גם על פונקציות serverless, שבהן כל בקשה
 * עלולה להגיע למופע אחר ומאגר בזיכרון היה נעלם.
 * ההגנות נשמרות: העוגייה מוחלפת בכל התחברות, קשורה לדפדפן שיצר אותה,
 * ופוקעת גם בזמן מוחלט וגם בחוסר פעילות.
 */

let fallbackSecret = null;

function secret() {
  if (config.sessionSecret) return config.sessionSecret;
  if (config.isServerless) {
    const error = new Error('חסר SESSION_SECRET במשתני הסביבה — הפאנל לא יכול לאמת התחברות');
    error.statusCode = 500;
    throw error;
  }
  // פיתוח מקומי בלבד: מתחלף בכל הפעלה, ולכן מנתק סשנים אחרי הפעלה מחדש
  if (!fallbackSecret) fallbackSecret = crypto.randomBytes(32).toString('hex');
  return fallbackSecret;
}

const newToken = () => crypto.randomBytes(32).toString('base64url');

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('base64url').slice(0, 22);

const uaFingerprint = (req) => digest(String(req.get('user-agent') || '').slice(0, 200));

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;

  const body = raw.slice(0, dot);
  const sent = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(crypto.createHmac('sha256', secret()).update(body).digest('base64url'));
  if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) return null;

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function isSecureRequest(req) {
  return config.forceSecureCookie || req.secure;
}

function baseCookieOptions(req) {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'strict',
    path: '/'
  };
}

function issue(req, res, session) {
  const token = sign(session);
  res.cookie(config.session.cookieName, token, {
    ...baseCookieOptions(req),
    maxAge: config.session.absoluteTtlMs
  });
  res.cookie(config.session.csrfCookieName, session.csrf, {
    ...baseCookieOptions(req),
    httpOnly: false, // נקרא ע"י פאנל הניהול ונשלח בכותרת X-CSRF-Token
    maxAge: config.session.absoluteTtlMs
  });
  return session;
}

function create(req, res, user) {
  const now = Date.now();
  return issue(req, res, {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    csrf: newToken(),
    createdAt: now,
    lastSeen: now,
    ua: uaFingerprint(req),
    // טביעת אצבע של הסיסמה — שינוי סיסמה מבטל אוטומטית כל סשן קיים
    pw: digest(user.password || '')
  });
}

function destroy(req, res) {
  res.clearCookie(config.session.cookieName, baseCookieOptions(req));
  res.clearCookie(config.session.csrfCookieName, { ...baseCookieOptions(req), httpOnly: false });
}

function resolve(req) {
  const raw = req.cookies?.[config.session.cookieName];
  if (!raw) return null;

  const session = unsign(raw);
  if (!session) return null;

  const now = Date.now();
  if (now - session.createdAt > config.session.absoluteTtlMs) return null;
  if (now - session.lastSeen > config.session.idleTtlMs) return null;

  // קשירת הסשן לדפדפן שיצר אותו — מקטין ערך של עוגייה גנובה
  if (session.ua !== uaFingerprint(req)) return null;

  // הסיסמה הוחלפה מאז ההתחברות
  const current = users.credentialFingerprint(session.username);
  if (!current || digest(current) !== session.pw) return null;

  return session;
}

function attach(req, res, next) {
  let session = null;
  try {
    session = resolve(req);
  } catch {
    session = null; // הגדרות חסרות — נטפל בזה במסלולי הניהול בלבד
  }
  req.session = session;

  // מאריכים את חלון חוסר הפעילות, אך לא בכל בקשה בודדת
  if (session && Date.now() - session.lastSeen > 60 * 1000) {
    issue(req, res, { ...session, lastSeen: Date.now() });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session) {
    res.status(401).json({ error: 'נדרשת התחברות מחדש' });
    return;
  }
  next();
}

/** השוואת CSRF בזמן קבוע + אימות Origin/Referer לבקשות משנות מצב */
function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.get('origin') || req.get('referer');
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const allowed = new Set([req.get('host')]);
    if (config.publicOrigin) {
      try {
        allowed.add(new URL(config.publicOrigin).host);
      } catch {
        /* מקור לא תקין בהגדרות — מתעלמים */
      }
    }
    if (!originHost || !allowed.has(originHost)) {
      return res.status(403).json({ error: 'בקשה ממקור לא מורשה' });
    }
  }

  const sent = Buffer.from(String(req.get('x-csrf-token') || ''));
  const expected = Buffer.from(String(req.session?.csrf || ''));
  if (!sent.length || sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
    return res.status(403).json({ error: 'אסימון אבטחה לא תקין — רעננו את הדף ונסו שוב' });
  }
  return next();
}

module.exports = { create, destroy, attach, requireAuth, requireCsrf, clientIp };
