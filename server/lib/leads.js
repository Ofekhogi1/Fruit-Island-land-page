'use strict';

/**
 * פניות שמגיעות מטופס "הצעה לאירוע".
 *
 * עד עכשיו הטופס רק פתח וואטסאפ עם הפרטים, וכל מי שלא לחץ "שליחה" שם
 * פשוט נעלם. כאן הפנייה נשמרת קודם כול אצלנו, ורק אחר כך מציעים למשתמש
 * להמשיך בוואטסאפ — כך שאף ליד לא הולך לאיבוד.
 *
 * כל פנייה נשמרת בקובץ נפרד ולא ברשימה אחת משותפת, כדי ששתי פניות
 * שמגיעות באותו רגע לא ידרסו זו את זו (בענן רצים כמה מופעים במקביל).
 */

const crypto = require('crypto');

const storage = require('./storage');

const PREFIX = 'data/leads';
const MAX_LIST = 200;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

class LeadError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

const clean = (value, max, { multiline = false } = {}) => {
  let text = String(value ?? '').replace(CONTROL_CHARS, '');
  text = multiline ? text.replace(/\r\n/g, '\n') : text.replace(/\s+/g, ' ');
  return text.trim().slice(0, max);
};

const EVENT_TYPES = [
  'חתונה',
  'בר / בת מצווה',
  'ברית או חינה',
  'יום הולדת',
  'אירוע עסקי / כנס',
  'גיבוש ומשרדים',
  'חג ואירוח משפחתי',
  'ביקור חולים / מתנה',
  'אחר'
];

/** מאמת ומנקה פנייה נכנסת. זורק LeadError עם הודעה בעברית לכל שדה חסר. */
function normalize(input) {
  const body = input && typeof input === 'object' ? input : {};

  const name = clean(body.name, 60);
  if (name.length < 2) throw new LeadError('חסר שם מלא');

  const phoneRaw = clean(body.phone, 20);
  const digits = phoneRaw.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 12) throw new LeadError('מספר טלפון לא תקין');

  if (body.consent !== true && body.consent !== 'on' && body.consent !== 'true') {
    throw new LeadError('צריך לאשר יצירת קשר');
  }

  const eventType = clean(body.eventType, 40);
  const eventDate = clean(body.eventDate, 10);
  const guestsNumber = Number.parseInt(clean(body.guests, 8), 10);

  return {
    name,
    phone: phoneRaw,
    phoneDigits: digits,
    /* ערך שלא מופיע ברשימה של הטופס נשמר כ"אחר" ולא נזרק */
    eventType: eventType && !EVENT_TYPES.includes(eventType) ? 'אחר' : eventType,
    eventDate: /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? eventDate : '',
    guests: Number.isFinite(guestsNumber) && guestsNumber > 0 && guestsNumber <= 5000 ? guestsNumber : null,
    city: clean(body.city, 40),
    notes: clean(body.notes, 600, { multiline: true })
  };
}

/** מזהה שמסודר לפי זמן — כך ש-list() ממוין לקסיקוגרפית הוא גם ממוין כרונולוגית */
function newId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `lead-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

const ID_RE = /^lead-[0-9A-Za-z\-]+$/;
const keyFor = (id) => {
  if (!ID_RE.test(id)) throw new LeadError('מזהה פנייה לא תקין');
  return `${PREFIX}/${id}.json`;
};

async function add(input) {
  const lead = normalize(input);
  const id = newId();
  const record = { id, receivedAt: new Date().toISOString(), handled: false, ...lead };
  await storage.writeJson(keyFor(id), record);
  /* בלוג נרשם רק שהגיעה פנייה — הפרטים עצמם נקראים בפאנל ולא בלוגים */
  console.log(`[lead] פנייה חדשה נשמרה (${id})`);
  return record;
}

async function list({ limit = 100 } = {}) {
  const entries = await storage.list(PREFIX);
  const recent = entries
    .filter((entry) => /^lead-.*\.json$/.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, Math.min(limit, MAX_LIST));

  const records = await Promise.all(recent.map((entry) => storage.readJson(entry.key)));
  return records.filter(Boolean);
}

async function setHandled(id, handled) {
  const key = keyFor(id);
  const record = await storage.readJson(key);
  if (!record) throw new LeadError('הפנייה לא נמצאה');
  record.handled = Boolean(handled);
  await storage.writeJson(key, record);
  return record;
}

async function remove(id) {
  await storage.remove(keyFor(id));
}

/** ייצוא לאקסל — מי שרוצה לעבוד עם הפניות מחוץ לפאנל */
function toCsv(records) {
  const head = ['תאריך פנייה', 'שם', 'טלפון', 'סוג אירוע', 'תאריך האירוע', 'אורחים', 'יישוב', 'הערות', 'טופל'];
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = records.map((r) =>
    [
      r.receivedAt,
      r.name,
      r.phone,
      r.eventType,
      r.eventDate,
      r.guests ?? '',
      r.city,
      r.notes,
      r.handled ? 'כן' : 'לא'
    ]
      .map(cell)
      .join(',')
  );
  /* BOM — בלעדיו אקסל בווינדוס מציג עברית כג'יבריש */
  return '﻿' + [head.map(cell).join(','), ...rows].join('\r\n') + '\r\n';
}

module.exports = { add, list, setHandled, remove, toCsv, LeadError };
