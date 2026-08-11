/* ══════════════════════════════════════════════════════════════
   Fruit Island — הזרמת תוכן מפאנל הניהול אל הדף
   הדף עובד גם בלי הקובץ הזה: ה-HTML מכיל את תוכן ברירת המחדל.
   כל טקסט מוזרק עם textContent בלבד — ללא HTML מהמשתמש.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SAFE_LINK = /^(https?:|mailto:|tel:|#|assets\/)/i;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function get(source, path) {
    return String(path).split('.').reduce(function (acc, key) {
      return acc == null ? undefined : acc[key];
    }, source);
  }

  function setText(el, value) {
    if (el && typeof value === 'string' && value !== '') el.textContent = value;
  }

  function safeUrl(value) {
    return typeof value === 'string' && value !== '' && SAFE_LINK.test(value) ? value : null;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(symbol, viewBox) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    if (viewBox) svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', symbol);
    svg.appendChild(use);
    return svg;
  }

  function figureImage(src, alt, label, className) {
    var figure = el('figure', className);
    if (label) figure.setAttribute('data-label', label);
    var img = el('img');
    img.src = src || '';
    img.alt = alt || label || '';
    img.loading = 'lazy';
    figure.appendChild(img);
    return figure;
  }

  function externalLink(anchor, url) {
    var value = safeUrl(url);
    if (!value) return;
    anchor.href = value;
    if (/^https?:/i.test(value) && value.indexOf(location.origin) !== 0) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
  }

  function replaceChildren(container, nodes) {
    if (!container) return;
    container.textContent = '';
    nodes.forEach(function (node) { container.appendChild(node); });
  }

  /* ───────── שדות פשוטים לפי data-cms ───────── */

  function applySimpleFields(content) {
    $$('[data-cms]').forEach(function (node) {
      setText(node, get(content, node.getAttribute('data-cms')));
    });

    $$('[data-cms-src]').forEach(function (node) {
      var value = get(content, node.getAttribute('data-cms-src'));
      if (typeof value !== 'string' || !value) return;
      if (node.tagName === 'SOURCE') {
        node.src = value;
        var media = node.parentElement;
        if (media && typeof media.load === 'function') media.load();
      } else {
        node.src = value;
      }
    });

    $$('[data-cms-href]').forEach(function (node) {
      var value = safeUrl(get(content, node.getAttribute('data-cms-href')));
      if (value) node.href = value;
    });

    $$('[data-cms-attr]').forEach(function (node) {
      var spec = node.getAttribute('data-cms-attr').split(':');
      var value = get(content, spec[1]);
      if (typeof value === 'string' && value) node.setAttribute(spec[0], value);
    });

    $$('[data-cms-list]').forEach(function (node) {
      var items = get(content, node.getAttribute('data-cms-list'));
      if (!Array.isArray(items) || !items.length) return;
      replaceChildren(node, items.map(function (text) { return el('li', null, text); }));
    });

    $$('[data-cms-tel]').forEach(function (node) {
      var value = get(content, node.getAttribute('data-cms-tel'));
      if (typeof value === 'string' && value) node.href = 'tel:' + value.replace(/[^\d+]/g, '');
    });

    $$('[data-cms-wa]').forEach(function (node) {
      var value = get(content, node.getAttribute('data-cms-wa'));
      if (typeof value === 'string' && value) node.href = 'https://wa.me/' + value.replace(/\D/g, '');
    });

    $$('[data-cms-mail]').forEach(function (node) {
      var value = get(content, node.getAttribute('data-cms-mail'));
      if (typeof value === 'string' && value) node.href = 'mailto:' + value;
    });
  }

  /* ───────── מקטעים חוזרים ───────── */

  var GALLERY_VARIANTS = ['g-card--tall', '', '', 'g-card--wide', '', '', 'g-card--tall', ''];

  var renderers = {
    'marquee.items': function (container, items) {
      var nodes = [];
      for (var pass = 0; pass < 2; pass += 1) {
        items.forEach(function (text) {
          nodes.push(el('span', null, text));
          nodes.push(el('i'));
        });
      }
      replaceChildren(container, nodes);
    },

    'gallery.items': function (container, items) {
      replaceChildren(container, items.map(function (item, index) {
        var variant = GALLERY_VARIANTS[index % GALLERY_VARIANTS.length];
        return figureImage(item.image, item.alt, item.label, ('g-card ph reveal ' + variant).trim());
      }));
    },

    'offer.items': function (container, items) {
      replaceChildren(container, items.map(function (item, index) {
        var card = el('article', 'o-card reveal' + (index === 1 ? ' o-card--feature' : ''));
        card.appendChild(figureImage(item.image, item.title, item.title, 'o-card__img arch ph'));
        card.appendChild(el('h3', null, item.title));
        card.appendChild(el('p', null, item.text));
        if (Array.isArray(item.bullets) && item.bullets.length) {
          var list = el('ul', 'mini-list');
          item.bullets.forEach(function (text) { list.appendChild(el('li', null, text)); });
          card.appendChild(list);
        }
        if (item.linkText && safeUrl(item.linkUrl)) {
          var link = el('a', 'link-arrow', item.linkText);
          externalLink(link, item.linkUrl);
          card.appendChild(link);
        }
        return card;
      }));
    },

    'events.items': function (container, items) {
      replaceChildren(container, items.map(function (item) {
        var li = el('li', 'ev reveal');
        var wrap = el('span', 'ev__ico');
        wrap.setAttribute('aria-hidden', 'true');
        wrap.appendChild(icon('#i-slice', '0 0 64 64'));
        li.appendChild(wrap);
        li.appendChild(el('h3', null, item.title));
        li.appendChild(el('p', null, item.text));
        return li;
      }));
    },

    'how.items': function (container, items) {
      replaceChildren(container, items.map(function (item, index) {
        var li = el('li', 'step reveal');
        li.appendChild(el('span', 'step__num', String(index + 1).padStart(2, '0')));
        li.appendChild(el('h3', null, item.title));
        li.appendChild(el('p', null, item.text));
        return li;
      }));
    },

    'why.items': function (container, items) {
      replaceChildren(container, items.map(function (item) {
        var card = el('article', 'w-card reveal');
        card.appendChild(el('h3', null, item.title));
        card.appendChild(el('p', null, item.text));
        return card;
      }));
    },

    'reviews.items': function (container, items) {
      replaceChildren(container, items.map(function (item) {
        var stars = Math.min(5, Math.max(1, parseInt(item.stars, 10) || 5));
        var figure = el('figure', 'rev reveal');
        var starsEl = el('div', 'rev__stars', '★'.repeat(stars));
        starsEl.setAttribute('aria-label', 'דירוג ' + stars + ' מתוך 5');
        figure.appendChild(starsEl);
        figure.appendChild(el('blockquote', null, item.text));
        var caption = el('figcaption');
        var mono = el('span', 'rev__mono', (item.author || '').charAt(0));
        mono.setAttribute('aria-hidden', 'true');
        caption.appendChild(mono);
        caption.appendChild(document.createTextNode(item.author || ''));
        figure.appendChild(caption);
        return figure;
      }));
    },

    'areas.hours': function (container, items) {
      replaceChildren(container, items.map(function (item) {
        var row = el('div');
        row.appendChild(el('dt', null, item.day));
        row.appendChild(el('dd', null, item.value));
        return row;
      }));
    },

    'faq.items': function (container, items) {
      replaceChildren(container, items.map(function (item) {
        var wrap = el('div', 'acc__item reveal');
        var button = el('button', 'acc__btn');
        button.type = 'button';
        button.setAttribute('aria-expanded', 'false');
        button.appendChild(el('span', null, item.question));
        var caret = el('i');
        caret.setAttribute('aria-hidden', 'true');
        button.appendChild(caret);
        var panel = el('div', 'acc__panel');
        panel.appendChild(el('p', null, item.answer));
        wrap.appendChild(button);
        wrap.appendChild(panel);
        return wrap;
      }));
    },

    'footer.infoLinks': function (container, items) {
      $$('a', container).forEach(function (node) { node.remove(); });
      items.forEach(function (item) {
        var link = el('a', null, item.text);
        externalLink(link, item.url);
        container.appendChild(link);
      });
    }
  };

  function applyRepeaters(content) {
    $$('[data-cms-repeat]').forEach(function (container) {
      var path = container.getAttribute('data-cms-repeat');
      var items = get(content, path);
      var render = renderers[path];
      if (!render || !Array.isArray(items) || !items.length) return;
      render(container, items);
    });
  }

  /* ───────── מטא ───────── */

  function applyMeta(content) {
    var site = content.site || {};
    if (site.title) document.title = site.title;
    var map = [
      ['meta[name="description"]', 'content', site.description],
      ['meta[property="og:title"]', 'content', site.ogTitle],
      ['meta[property="og:description"]', 'content', site.ogDescription],
      ['meta[property="og:image"]', 'content', site.ogImage],
      ['link[rel="icon"]', 'href', site.favicon]
    ];
    map.forEach(function (entry) {
      var node = $(entry[0]);
      if (node && typeof entry[2] === 'string' && entry[2]) node.setAttribute(entry[1], entry[2]);
    });
  }

  /* ───────── הרצה ───────── */

  function apply(content) {
    if (!content || typeof content !== 'object') return;
    applyMeta(content);
    applySimpleFields(content);
    applyRepeaters(content);
    window.FI_CONTENT = content;
    document.dispatchEvent(new CustomEvent('cms:applied', { detail: content }));
  }

  fetch('/api/content', { credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (payload) { if (payload && payload.content) apply(payload.content); })
    .catch(function () { /* ללא שרת — נשאר תוכן ברירת המחדל שב-HTML */ });
})();
