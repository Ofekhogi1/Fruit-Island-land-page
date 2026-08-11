'use strict';

const crypto = require('crypto');
const config = require('../config');

/**
 * מאגר סשנים בזיכרון: מזהה הסשן אף פעם לא נשמר בצד הלקוח יחד עם מידע נוסף,
 * והוא מסתובב בכל התחברות כדי למנוע session fixation.
 */
const sessions = new Map();

const newToken = () => crypto.randomBytes(32).toString('base64url');

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

function create(req, res, user) {
  const sid = newToken();
  const now = Date.now();
  const session = {
    sid,
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    csrf: newToken(),
    createdAt: now,
    lastSeen: now,
    ip: clientIp(req),
    userAgent: String(req.get('user-agent') || '').slice(0, 200)
  };
  sessions.set(sid, session);

  res.cookie(config.session.cookieName, sid, {
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

function destroy(req, res) {
  const sid = req.cookies?.[config.session.cookieName];
  if (sid) sessions.delete(sid);
  res.clearCookie(config.session.cookieName, baseCookieOptions(req));
  res.clearCookie(config.session.csrfCookieName, { ...baseCookieOptions(req), httpOnly: false });
}

function destroyAllForUser(userId) {
  for (const [sid, session] of sessions) {
    if (session.userId === userId) sessions.delete(sid);
  }
}

function resolve(req) {
  const sid = req.cookies?.[config.session.cookieName];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;

  const now = Date.now();
  if (now - session.createdAt > config.session.absoluteTtlMs || now - session.lastSeen > config.session.idleTtlMs) {
    sessions.delete(sid);
    return null;
  }
  // קשירת הסשן לדפדפן שיצר אותו — מקטין ערך של עוגייה גנובה
  if (session.userAgent !== String(req.get('user-agent') || '').slice(0, 200)) {
    sessions.delete(sid);
    return null;
  }
  session.lastSeen = now;
  return session;
}

function attach(req, res, next) {
  req.session = resolve(req);
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

setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.createdAt > config.session.absoluteTtlMs || now - session.lastSeen > config.session.idleTtlMs) {
      sessions.delete(sid);
    }
  }
}, 5 * 60 * 1000).unref();

module.exports = { create, destroy, destroyAllForUser, attach, requireAuth, requireCsrf, clientIp };
