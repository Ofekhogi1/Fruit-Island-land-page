'use strict';

/**
 * סכימת התוכן — מקור אמת יחיד.
 * הפאנל בונה ממנה את הטפסים, והשרת מאמת מולה כל שמירה.
 *
 * type: text | textarea | url | tel | email | image | video | list | repeater
 */

const SECTIONS = [
  {
    id: 'site',
    label: 'כללי ו‑SEO',
    fields: [
      { key: 'title', label: 'כותרת הדף (title)', type: 'text', max: 120 },
      { key: 'description', label: 'תיאור לגוגל (description)', type: 'textarea', max: 320 },
      { key: 'ogTitle', label: 'כותרת לשיתוף ברשתות', type: 'text', max: 120 },
      { key: 'ogDescription', label: 'תיאור לשיתוף ברשתות', type: 'textarea', max: 320 },
      { key: 'ogImage', label: 'תמונת שיתוף (1200×630)', type: 'image' },
      { key: 'logo', label: 'לוגו', type: 'image' },
      { key: 'favicon', label: 'אייקון לשונית', type: 'image' }
    ]
  },
  {
    id: 'contact',
    label: 'פרטי קשר',
    fields: [
      { key: 'phonePrimary', label: 'טלפון ראשי (תצוגה)', type: 'text', max: 30 },
      { key: 'phonePrimaryDial', label: 'טלפון ראשי (לחיוג)', type: 'tel', max: 30 },
      { key: 'phoneSecondary', label: 'טלפון נוסף (תצוגה)', type: 'text', max: 30 },
      { key: 'phoneSecondaryDial', label: 'טלפון נוסף (לחיוג)', type: 'tel', max: 30 },
      { key: 'email', label: 'אימייל', type: 'email', max: 120 },
      { key: 'whatsappNumber', label: 'מספר וואטסאפ (בפורמט בינלאומי)', type: 'text', max: 20 },
      { key: 'address', label: 'כתובת', type: 'text', max: 120 },
      { key: 'mapUrl', label: 'קישור לגוגל מפות', type: 'url' },
      { key: 'instagram', label: 'אינסטגרם', type: 'url' },
      { key: 'facebook', label: 'פייסבוק', type: 'url' }
    ]
  },
  {
    id: 'hero',
    label: 'מסך פתיחה',
    fields: [
      { key: 'video', label: 'סרטון רקע', type: 'video' },
      { key: 'poster', label: 'תמונת רקע (עד שהסרטון נטען)', type: 'image' },
      { key: 'eyebrow', label: 'שורת פתיחה קטנה', type: 'text', max: 80 },
      { key: 'titleLine1', label: 'כותרת — שורה ראשונה', type: 'text', max: 60 },
      { key: 'titleLine2', label: 'כותרת — שורה שנייה (מודגשת)', type: 'text', max: 60 },
      { key: 'sub', label: 'תת‑כותרת', type: 'textarea', max: 400 },
      { key: 'ctaPrimary', label: 'כפתור ראשי', type: 'text', max: 40 },
      { key: 'ctaSecondary', label: 'כפתור משני', type: 'text', max: 40 },
      { key: 'trust', label: 'שורת אמון', type: 'list', max: 40, maxItems: 6 }
    ]
  },
  {
    id: 'marquee',
    label: 'פס נע',
    fields: [{ key: 'items', label: 'משפטים', type: 'list', max: 60, maxItems: 12 }]
  },
  {
    id: 'signature',
    label: 'המיצג המרכזי',
    fields: [
      { key: 'kicker', label: 'תווית', type: 'text', max: 60 },
      { key: 'title', label: 'כותרת', type: 'text', max: 140 },
      { key: 'lead', label: 'פסקה', type: 'textarea', max: 700 },
      { key: 'bullets', label: 'נקודות', type: 'list', max: 120, maxItems: 8 },
      { key: 'cta', label: 'כפתור', type: 'text', max: 40 },
      { key: 'image', label: 'תמונה ראשית', type: 'image' },
      { key: 'imageDetail', label: 'תמונת תקריב', type: 'image' },
      { key: 'badgeNumber', label: 'מדבקה — מספר', type: 'text', max: 8 },
      { key: 'badgeText', label: 'מדבקה — טקסט', type: 'text', max: 24 }
    ]
  },
  {
    id: 'gallery',
    label: 'גלריה',
    fields: [
      { key: 'kicker', label: 'תווית', type: 'text', max: 60 },
      { key: 'title', label: 'כותרת', type: 'text', max: 140 },
      { key: 'sub', label: 'תת‑כותרת', type: 'textarea', max: 300 },
      {
        key: 'items',
        label: 'תמונות',
        type: 'repeater',
        itemLabel: 'תמונה',
        maxItems: 24,
        titleField: 'label',
        fields: [
          { key: 'image', label: 'תמונה', type: 'image' },
          { key: 'label', label: 'תווית (מוצגת כשאין תמונה)', type: 'text', max: 60 },
          { key: 'alt', label: 'תיאור לנגישות', type: 'text', max: 140 }
        ]
      },
      { key: 'noteText', label: 'הערה מתחת לגלריה', type: 'text', max: 160 },
      { key: 'noteLinkText', label: 'טקסט הקישור', type: 'text', max: 60 },
      { key: 'noteLinkUrl', label: 'כתובת הקישור', type: 'url' }
    ]
  },
  {
    id: 'offer',
    label: 'מה מזמינים',
    fields: [
      { key: 'kicker', label: 'תווית', type: 'text', max: 60 },
      { key: 'title', label: 'כותרת', type: 'text', max: 140 },
      {
        key: 'items',
        label: 'כרטיסים',
        type: 'repeater',
        itemLabel: 'כרטיס',
        maxItems: 6,
        titleField: 'title',
        fields: [
          { key: 'image', label: 'תמונה', type: 'image' },
          { key: 'title', label: 'כותרת', type: 'text', max: 80 },
          { key: 'text', label: 'תיאור', type: 'textarea', max: 400 },
          { key: 'bullets', label: 'נקודות', type: 'list', max: 100, maxItems: 6 },
          { key: 'linkText', label: 'טקסט הקישור', type: 'text', max: 60 },
          { key: 'linkUrl', label: 'כתובת הקישור', type: 'url' }
        ]
      }
    ]
  },
  {
    id: 'events',
    label: 'סוגי אירועים',
    fields: [
      { key: 'kicker', label: 'תווית', type: 'text', max: 60 },
      { key: 'title', label: 'כותרת', type: 'text', max: 140 },
      { key: 'sub', label: 'תת‑כותרת', type: 'textarea', max: 300 },
      {
        key: 'items',
        label: 'אירועים',
        type: 'repeater',
        itemLabel: 'אירוע',
        maxItems: 16,
        titleField: 'title',
        fields: [
          { key: 'title', label: 'כותרת', type: 'text', max: 60 },
          { key: 'text', label: 'תיאור', type: 'textarea', max: 200 }
        ]
      }
    ]
  },
  {
    id: 'how',
    label: 'איך מזמינים',
    fields: [
      { key: 'kicker', label: 'תווית', type: 'text', max: 60 },
      { key: 'title', label: 'כותרת', type: 'text', max: 140 },
      {
        key: 'items',
        label: 'שלבים',
        type: 'repeater',
        itemLabel: 'שלב',
        maxItems: 8,
        titleField: 'title',
        fields: [
          { key: 'title', label: 'כותרת', type: 'text', max: 80 },
          { key: 'text', label: 'תיאור', type: 'textarea', max: 240 }
        ]
      }
    ]
  },
  {
    id: 'why',
    label: 'למה אנחנו',
    fields: [
      { key: 'kicker', label: 'תווית', type: 'text', max: 60 },
      { key: 'title', label: 'כותרת', type: 'text', max: 140 },
      {
        key: 'items',
        label: 'כרטיסים',
        type: 'repeater',
        itemLabel: 'כרטיס',
        maxItems: 12,
        titleField: 'title',
        fields: [
          { key: 'title', label: 'כותרת', type: 'text', max: 80 },
          { key: 'text', label: 'תיאור', type: 'textarea', max: 260 }
        ]
      }
    ]
  },
  {
    id: 'reviews',
    label: 'ביקורות',
    fields: [
      { key: 'kicker', label: 'תווית', type: 'text', max: 60 },
      { key: 'title', label: 'כותרת', type: 'text', max: 140 },
      {
        key: 'items',
        label: 'ביקורות',
        type: 'repeater',
        itemLabel: 'ביקורת',
        maxItems: 12,
        titleField: 'author',
        fields: [
          { key: 'stars', label: 'כוכבים (1–5)', type: 'text', max: 1 },
          { key: 'text', label: 'תוכן', type: 'textarea', max: 500 },
          { key: 'author', label: 'שם הלקוח', type: 'text', max: 60 }
        ]
      }
    ]
  },
  {
    id: 'areas',
    label: 'אזורי משלוח',
    fields: [
      { key: 'kicker', label: 'תווית', type: 'text', max: 60 },
      { key: 'title', label: 'כותרת', type: 'text', max: 140 },
      { key: 'lead', label: 'פסקה', type: 'textarea', max: 500 },
      { key: 'list', label: 'שורות אזורים', type: 'list', max: 220, maxItems: 20 },
      { key: 'noteBefore', label: 'הערה — לפני הטלפון', type: 'text', max: 80 },
      { key: 'noteAfter', label: 'הערה — אחרי הטלפון', type: 'text', max: 80 },
      { key: 'hoursTitle', label: 'כותרת זמני חלוקה', type: 'text', max: 60 },
      {
        key: 'hours',
        label: 'זמני חלוקה',
        type: 'repeater',
        itemLabel: 'שורה',
        maxItems: 10,
        titleField: 'day',
        fields: [
          { key: 'day', label: 'ימים', type: 'text', max: 40 },
          { key: 'value', label: 'שעות', type: 'text', max: 40 }
        ]
      },
      { key: 'pickupTitle', label: 'כותרת איסוף עצמי', type: 'text', max: 60 },
      { key: 'pickupText', label: 'כתובת איסוף', type: 'text', max: 120 },
      { key: 'pickupLinkText', label: 'טקסט קישור למפות', type: 'text', max: 60 },
      { key: 'contactTitle', label: 'כותרת יצירת קשר', type: 'text', max: 60 }
    ]
  },
  {
    id: 'faq',
    label: 'שאלות נפוצות',
    fields: [
      { key: 'kicker', label: 'תווית', type: 'text', max: 60 },
      { key: 'title', label: 'כותרת', type: 'text', max: 140 },
      {
        key: 'items',
        label: 'שאלות',
        type: 'repeater',
        itemLabel: 'שאלה',
        maxItems: 20,
        titleField: 'question',
        fields: [
          { key: 'question', label: 'שאלה', type: 'text', max: 160 },
          { key: 'answer', label: 'תשובה', type: 'textarea', max: 800 }
        ]
      }
    ]
  },
  {
    id: 'quote',
    label: 'טופס הצעת מחיר',
    fields: [
      { key: 'kicker', label: 'תווית', type: 'text', max: 60 },
      { key: 'titleLine1', label: 'כותרת — שורה ראשונה', type: 'text', max: 100 },
      { key: 'titleLine2', label: 'כותרת — שורה שנייה', type: 'text', max: 100 },
      { key: 'lead', label: 'פסקה', type: 'textarea', max: 500 },
      { key: 'waButton', label: 'כפתור וואטסאפ', type: 'text', max: 40 },
      { key: 'trust', label: 'שורת אמון', type: 'list', max: 40, maxItems: 6 },
      { key: 'formTitle', label: 'כותרת הטופס', type: 'text', max: 80 },
      { key: 'submitText', label: 'טקסט כפתור שליחה', type: 'text', max: 40 },
      { key: 'fine', label: 'טקסט משפטי קטן', type: 'textarea', max: 300 },
      { key: 'formEndpoint', label: 'כתובת שירות טפסים (ריק = שליחה בוואטסאפ)', type: 'url' }
    ]
  },
  {
    id: 'footer',
    label: 'פוטר',
    fields: [
      { key: 'about', label: 'תיאור קצר', type: 'textarea', max: 400 },
      { key: 'navTitle', label: 'כותרת עמודת ניווט', type: 'text', max: 40 },
      { key: 'contactTitle', label: 'כותרת עמודת קשר', type: 'text', max: 40 },
      { key: 'infoTitle', label: 'כותרת עמודת מידע', type: 'text', max: 40 },
      {
        key: 'infoLinks',
        label: 'קישורי מידע',
        type: 'repeater',
        itemLabel: 'קישור',
        maxItems: 10,
        titleField: 'text',
        fields: [
          { key: 'text', label: 'טקסט', type: 'text', max: 60 },
          { key: 'url', label: 'כתובת', type: 'url' }
        ]
      },
      { key: 'copyright', label: 'שורת זכויות (ללא השנה)', type: 'text', max: 120 },
      { key: 'tagline', label: 'שורה שנייה', type: 'text', max: 140 }
    ]
  }
];

const MAX_TEXT = 2000;
const MAX_LIST_ITEMS = 40;

module.exports = { SECTIONS, MAX_TEXT, MAX_LIST_ITEMS };
