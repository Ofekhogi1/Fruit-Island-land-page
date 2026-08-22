/* ══════════════════════════════════════════════════════════════
   Fruit Island — Landing page behaviour
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────
     הגדרות הטופס מגיעות מפאנל הניהול (assets/js/cms.js).
     כשאין שרת — נעשה שימוש בערכי ברירת המחדל שכאן.
     ──────────────────────────────────────────────────────────── */
  /* ברירת המחדל: הפנייה נשמרת בשרת שלנו ונקראת בפאנל הניהול.
     אפשר להזין בפאנל כתובת של שירות טפסים חיצוני כדי לעקוף את זה. */
  var DEFAULT_FORM_ENDPOINT = '/api/lead';
  var DEFAULT_WHATSAPP_NUMBER = '972502616666';

  function cms(path, fallback) {
    var value = String(path).split('.').reduce(function (acc, key) {
      return acc == null ? undefined : acc[key];
    }, window.FI_CONTENT);
    return typeof value === 'string' && value !== '' ? value : fallback;
  }

  var formEndpoint = function () { return cms('quote.formEndpoint', DEFAULT_FORM_ENDPOINT); };
  var whatsappNumber = function () { return cms('contact.whatsappNumber', DEFAULT_WHATSAPP_NUMBER).replace(/\D/g, ''); };

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* ───────── שנה בפוטר ───────── */
  var yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ───────── תמונות חסרות → ממלא מקום ───────── */
  function markMissingImages() {
    $$('.ph img').forEach(function (img) {
      if (img.dataset.phBound === '1') return;
      img.dataset.phBound = '1';
      var mark = function () {
        var host = img.closest('.ph');
        if (host) host.classList.add('is-empty');
      };
      var unmark = function () {
        var host = img.closest('.ph');
        if (host) host.classList.remove('is-empty');
      };
      img.addEventListener('error', mark);
      img.addEventListener('load', unmark);
      if (img.complete && img.naturalWidth === 0) mark();
    });
  }
  markMissingImages();

  /* ───────── וידאו חסר בהירו ───────── */
  var heroVideo = $('.hero__video');
  if (heroVideo) {
    var src = heroVideo.querySelector('source');
    if (src) src.addEventListener('error', function () { heroVideo.remove(); });
    if (reduceMotion) heroVideo.pause();
  }

  /* ───────── כותרת דביקה + סרגל התקדמות ───────── */
  var head = $('#siteHead');
  var progress = $('#headProgress');
  var ticking = false;

  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (head) head.classList.toggle('is-stuck', y > 40);
    if (progress) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
    }
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { window.requestAnimationFrame(onScroll); ticking = true; }
  }, { passive: true });
  onScroll();

  /* ───────── תפריט מובייל ───────── */
  var burger = $('#burger');
  var nav = $('#nav');
  function closeNav() {
    if (!nav || !burger) return;
    nav.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'פתיחת תפריט');
    document.body.classList.remove('is-locked');
  }
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'סגירת תפריט' : 'פתיחת תפריט');
      document.body.classList.toggle('is-locked', open);
    });
    $$('a', nav).forEach(function (a) { a.addEventListener('click', closeNav); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });
  }

  /* ───────── סימון קישור פעיל ───────── */
  var navLinks = nav ? $$('a[href^="#"]', nav) : [];
  var sections = navLinks
    .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ───────── חשיפה בגלילה ───────── */
  var revealer = null;
  if (!reduceMotion && 'IntersectionObserver' in window) {
    revealer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        obs.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
  }

  function observeReveals() {
    $$('.reveal').forEach(function (el) {
      if (el.dataset.revealBound === '1') return;
      el.dataset.revealBound = '1';
      if (revealer) revealer.observe(el);
      else el.classList.add('is-in');
    });
  }
  observeReveals();

  /* ───────── פרלקסה עדינה ───────── */
  var runParallax = function () {};
  if (!reduceMotion) {
    var pTicking = false;
    runParallax = function () {
      var vh = window.innerHeight;
      $$('[data-parallax]').forEach(function (el) {
        var rect = el.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > vh + 200) return;
        var factor = parseFloat(el.getAttribute('data-parallax')) || 0;
        var offset = (rect.top + rect.height / 2 - vh / 2) * factor;
        el.style.transform = 'translate3d(0,' + offset.toFixed(1) + 'px,0)';
      });
      pTicking = false;
    };
    window.addEventListener('scroll', function () {
      if (!pTicking) { window.requestAnimationFrame(runParallax); pTicking = true; }
    }, { passive: true });
    window.addEventListener('resize', runParallax);
    runParallax();
  }

  /* ───────── אקורדיון שאלות נפוצות ───────── */
  function bindAccordion() {
    $$('.acc__item').forEach(function (item, i) {
      var btn = $('.acc__btn', item);
      var panel = $('.acc__panel', item);
      if (!btn || !panel || btn.dataset.accBound === '1') return;
      btn.dataset.accBound = '1';
      panel.id = 'acc-panel-' + (i + 1);
      btn.setAttribute('aria-controls', panel.id);
      btn.addEventListener('click', function () {
        var open = item.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }
  bindAccordion();

  /* ───────── ריענון אחרי טעינת תוכן מהפאנל ───────── */
  document.addEventListener('cms:applied', function () {
    markMissingImages();
    observeReveals();
    bindAccordion();
    runParallax();
    onScroll();
  });

  /* ───────── טופס הצעת מחיר ───────── */
  var form = $('#quoteForm');
  if (!form) return;

  var statusEl = $('#qStatus');
  var submitBtn = $('#qSubmit');

  function setError(input, message) {
    var field = input.closest('.field') || input.closest('.check');
    var slot = document.querySelector('[data-err-for="' + input.id + '"]');
    if (field) field.classList.toggle('has-error', Boolean(message));
    if (slot) slot.textContent = message || '';
  }

  function clearErrors() {
    $$('.has-error', form).forEach(function (f) { f.classList.remove('has-error'); });
    $$('.field__err', form).forEach(function (f) { f.textContent = ''; });
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'qform__status' + (kind ? ' is-' + kind : '');
  }

  function digitsOnly(value) { return value.replace(/\D+/g, ''); }

  function validate() {
    clearErrors();
    var ok = true;
    var name = $('#q-name');
    var phone = $('#q-phone');
    var consent = $('#q-consent');

    if (name.value.trim().length < 2) {
      setError(name, 'נשמח לדעת איך לפנות אליכם');
      ok = false;
    }
    var digits = digitsOnly(phone.value);
    if (digits.length < 9 || digits.length > 12) {
      setError(phone, 'מספר טלפון לא תקין');
      ok = false;
    }
    if (!consent.checked) {
      setError(consent, 'צריך לאשר יצירת קשר כדי שנוכל לחזור אליכם');
      ok = false;
    }
    if (!ok) {
      var firstBad = $('.field.has-error input, .field.has-error select, .check.has-error input', form);
      if (firstBad) firstBad.focus();
    }
    return ok;
  }

  function collect() {
    return {
      name: $('#q-name').value.trim(),
      phone: $('#q-phone').value.trim(),
      eventType: $('#q-event').value,
      eventDate: $('#q-date').value,
      guests: $('#q-guests').value.trim(),
      city: $('#q-city').value.trim(),
      notes: $('#q-notes').value.trim(),
      consent: $('#q-consent').checked,
      company: $('#q-company').value
    };
  }

  function toWhatsAppText(d) {
    var lines = ['היי Fruit Island, אשמח להצעה לאירוע:'];
    lines.push('שם: ' + d.name);
    lines.push('טלפון: ' + d.phone);
    if (d.eventType) lines.push('סוג האירוע: ' + d.eventType);
    if (d.eventDate) lines.push('תאריך: ' + d.eventDate);
    if (d.guests) lines.push('מספר אורחים: ' + d.guests);
    if (d.city) lines.push('יישוב: ' + d.city);
    if (d.notes) lines.push('הערות: ' + d.notes);
    return lines.join('\n');
  }

  var followUp = $('#qWhatsApp');

  /** מציג קישור וואטסאפ מוכן עם הפרטים, אחרי שהפנייה כבר נשמרה */
  function showFollowUp(d) {
    if (!followUp) return;
    followUp.href = 'https://wa.me/' + whatsappNumber() + '?text=' + encodeURIComponent(toWhatsAppText(d));
    followUp.hidden = false;
  }

  function openWhatsApp(d) {
    var url = 'https://wa.me/' + whatsappNumber() + '?text=' + encodeURIComponent(toWhatsAppText(d));
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    // מלכודת בוטים — שדה מוסתר שאמור להישאר ריק
    if ($('#q-company').value !== '') return;

    if (!validate()) {
      setStatus('כמה פרטים חסרים — בדקו את השדות המסומנים.', 'bad');
      return;
    }

    var data = collect();
    submitBtn.disabled = true;
    var endpoint = formEndpoint();

    if (!endpoint) {
      submitBtn.disabled = false;
      setStatus('פותחים עבורכם וואטסאפ עם הפרטים — רק ללחוץ שליחה.', 'ok');
      openWhatsApp(data);
      return;
    }

    setStatus('שולחים…', null);
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (res.ok) return body;
          var error = new Error(body.error || 'bad response');
          /* 4xx = משהו בטופס שהמשתמש יכול לתקן. 5xx/נפילת רשת = הבעיה אצלנו. */
          error.userFixable = res.status >= 400 && res.status < 500;
          throw error;
        });
      })
      .then(function () {
        form.reset();
        clearErrors();
        setStatus('הפנייה נשלחה ונשמרה אצלנו. נחזור אליכם בהקדם בשעות הפעילות.', 'ok');
        /* הפרטים כבר אצלנו — וואטסאפ נשאר קיצור דרך למי שרוצה תשובה עכשיו,
           ולא הדרך היחידה שהפנייה מגיעה. */
        showFollowUp(data);
      })
      .catch(function (error) {
        if (error.userFixable) {
          setStatus(error.message, 'bad');
          return;
        }
        setStatus('השליחה לא הצליחה. פותחים וואטסאפ כדי שלא תאבדו את הפרטים.', 'bad');
        openWhatsApp(data);
      })
      .finally(function () { submitBtn.disabled = false; });
  });

  $$('#q-name, #q-phone, #q-consent').forEach(function (input) {
    input.addEventListener('input', function () { setError(input, ''); if (followUp) followUp.hidden = true; });
    input.addEventListener('change', function () { setError(input, ''); });
  });
})();
