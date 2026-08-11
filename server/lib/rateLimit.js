'use strict';

/** מגביל קצב פשוט בזיכרון — חלון מתגלגל לכל מפתח */
function createRateLimiter({ windowMs, max, keyGenerator, message, blockMs }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now && (!entry.blockedUntil || entry.blockedUntil <= now)) hits.delete(key);
    }
  }, Math.min(windowMs, 60_000)).unref();

  function consume(key) {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs, blockedUntil: 0 };
      hits.set(key, entry);
    }
    if (entry.blockedUntil > now) {
      return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    entry.count += 1;
    if (entry.count > max) {
      entry.blockedUntil = now + (blockMs || windowMs);
      return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  function reset(key) {
    hits.delete(key);
  }

  function middleware(req, res, next) {
    const key = keyGenerator ? keyGenerator(req) : req.ip;
    const result = consume(key);
    if (result.allowed) return next();
    res.set('Retry-After', String(result.retryAfter));
    return res.status(429).json({ error: message || 'יותר מדי בקשות — נסו שוב מאוחר יותר' });
  }

  return { middleware, consume, reset };
}

module.exports = { createRateLimiter };
