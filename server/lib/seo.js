'use strict';

/**
 * כותרות ה-SEO והנתונים המובנים נבנים בשרת מתוך התוכן של פאנל הניהול.
 * זה הכרחי: סורקים של גוגל, ווטסאפ ופייסבוק לא מריצים JavaScript, ולכן
 * assets/js/cms.js לא יכול לעדכן עבורם את התגיות — רק ה-HTML שנשלח מהשרת.
 */

const config = require('../config');

/* דומיין ברירת המחדל, כפי שכתוב ב-index.html. PUBLIC_ORIGIN דורס אותו. */
const DEFAULT_ORIGIN = 'https://fruitisland.co.il';

const origin = () => config.publicOrigin || DEFAULT_ORIGIN;

/** כתובת יחסית → כתובת מלאה. תגיות og: ו-canonical חייבות כתובת מלאה. */
function absolute(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${origin()}/${raw.replace(/^\.?\/+/, '')}`;
}

const escapeAttr = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 0502616666 → +972502616666 */
function intlPhone(dial) {
  const digits = String(dial || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('0') ? `+972${digits.slice(1)}` : `+${digits}`;
}

/* ───────── שעות פתיחה ───────── */

const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "ראשון–חמישי" → כל הימים שביניהם. "שישי" → יום בודד. אחרת null. */
function daysFrom(label) {
  const parts = String(label || '')
    .split(/[–—\-]|\s+עד\s+/)
    .map((part) => HEB_DAYS.indexOf(part.trim()))
    .filter((index) => index !== -1);
  if (!parts.length) return null;
  if (parts.length === 1) return [EN_DAYS[parts[0]]];
  const [start, end] = [parts[0], parts[parts.length - 1]];
  if (end < start) return null;
  return EN_DAYS.slice(start, end + 1);
}

function openingHours(hours) {
  if (!Array.isArray(hours)) return [];
  const out = [];
  for (const row of hours) {
    const times = String((row && row.value) || '').match(/(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/);
    const dayOfWeek = daysFrom(row && row.day);
    /* שורה בלי טווח שעות ("אין משלוחים") היא יום סגור — פשוט לא מצהירים עליו */
    if (!times || !dayOfWeek) continue;
    out.push({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: dayOfWeek.length === 1 ? dayOfWeek[0] : dayOfWeek,
      opens: times[1].padStart(5, '0'),
      closes: times[2].padStart(5, '0')
    });
  }
  return out;
}

/* ───────── נתונים מובנים ───────── */

/** "יהוד · אור יהודה · סביון" → ["יהוד","אור יהודה","סביון"] */
function citiesFrom(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const row of list) {
    for (const city of String(row).split(/[·,|]/)) {
      const name = city.trim();
      if (name) seen.add(name);
    }
  }
  return [...seen];
}

function structuredData(content) {
  const site = content.site || {};
  const contact = content.contact || {};
  const areas = content.areas || {};
  const faqItems = (content.faq && content.faq.items) || [];
  const base = origin();

  const business = {
    '@type': 'LocalBusiness',
    '@id': `${base}/#business`,
    name: 'Fruit Island',
    description: site.description || '',
    url: `${base}/`,
    image: absolute(site.ogImage || 'assets/images/og-cover.jpg'),
    logo: absolute(site.logo || 'assets/images/logo.png'),
    telephone: intlPhone(contact.phonePrimaryDial),
    email: contact.email || undefined,
    priceRange: '₪₪',
    currenciesAccepted: 'ILS',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'קדושי מצרים 8',
      addressLocality: 'יהוד',
      addressCountry: 'IL'
    },
    areaServed: citiesFrom(areas.list).map((name) => ({ '@type': 'City', name })),
    sameAs: [contact.instagram, contact.facebook].filter(Boolean),
    openingHoursSpecification: openingHours(areas.hours)
  };

  const graph = [business];

  /* FAQPage — מזכה בתוצאות עשירות בגוגל, ומתעדכן לבד מפאנל הניהול */
  const questions = faqItems.filter((item) => item && item.question && item.answer);
  if (questions.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${base}/#faq`,
      mainEntity: questions.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer }
      }))
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

/** JSON בתוך <script> — חייבים לנטרל "<" כדי שלא ייסגר התג מוקדם */
const embedJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/* ───────── הזרקה אל ה-HTML ───────── */

function replaceTitle(html, value) {
  if (!value) return html;
  return html.replace(/(<title>)[\s\S]*?(<\/title>)/i, (match, open, close) =>
    `${open}${escapeAttr(value)}${close}`
  );
}

function replaceMeta(html, attr, key, value) {
  if (!value) return html;
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, 'i');
  return html.replace(re, (match, open, close) => `${open}${escapeAttr(value)}${close}`);
}

/**
 * מעדכן את ראש הדף לפי התוכן השמור ומזריק את הנתונים המובנים.
 * ה-HTML הסטטי נשאר תקין בפני עצמו — כאן רק דורסים ערכים.
 */
function applyHead(html, content, nonce) {
  const site = (content && content.site) || {};
  let out = html;

  out = replaceTitle(out, site.title);
  out = replaceMeta(out, 'name', 'description', site.description);
  out = replaceMeta(out, 'property', 'og:title', site.ogTitle || site.title);
  out = replaceMeta(out, 'property', 'og:description', site.ogDescription || site.description);
  out = replaceMeta(out, 'property', 'og:image', absolute(site.ogImage));
  out = replaceMeta(out, 'name', 'twitter:title', site.ogTitle || site.title);
  out = replaceMeta(out, 'name', 'twitter:description', site.ogDescription || site.description);
  out = replaceMeta(out, 'name', 'twitter:image', absolute(site.ogImage));

  /* דומיין חלופי (סביבת בדיקות) — מיישרים את כל הכתובות המוחלטות */
  if (origin() !== DEFAULT_ORIGIN) out = out.split(DEFAULT_ORIGIN).join(origin());

  const json = embedJson(structuredData(content || {}));
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  out = out.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `<script type="application/ld+json"${nonceAttr}>${json}</script>`
  );

  return out;
}

/** מפת אתר — עמוד יחיד, אבל גוגל מצפה למצוא אותה דרך robots.txt */
function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url>\n    <loc>${origin()}/</loc>\n    <lastmod>${today}</lastmod>\n` +
    '    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n' +
    '</urlset>\n'
  );
}

module.exports = { applyHead, sitemap, origin, absolute };
