/* ══════════════════════════════════════════════════════════════
   Fruit Island — פאנל ניהול התוכן
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var state = {
    sections: [],
    limits: null,
    content: {},
    activeSection: null,
    dirty: false,
    view: 'section'
  };

  var elContent = document.getElementById('content');
  var elNav = document.getElementById('sectionNav');
  var elTitle = document.getElementById('sectionTitle');
  var elSaveState = document.getElementById('saveState');
  var saveBtn = document.getElementById('saveBtn');
  var reloadBtn = document.getElementById('reloadBtn');

  /* ───────── תשתית ───────── */

  function cookie(name) {
    return document.cookie.split('; ').reduce(function (acc, part) {
      var pair = part.split('=');
      return pair[0] === name ? decodeURIComponent(pair.slice(1).join('=')) : acc;
    }, '');
  }

  function api(method, path, body, options) {
    var opts = options || {};
    var init = {
      method: method,
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': cookie('fi_csrf') }
    };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch('/api/admin' + path, init).then(function (res) {
      if (res.status === 401 && !opts.allowUnauthorized) {
        window.location.replace('/admin/login');
        throw new Error('unauthorized');
      }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
        return data;
      });
    });
  }

  var toastTimer;
  function toast(message, kind) {
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' is-' + kind : '');
    node.setAttribute('role', 'status');
    node.textContent = message;
    document.body.appendChild(node);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.remove(); }, 4000);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(label, className, onClick) {
    var node = el('button', 'btn ' + className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function markDirty() {
    state.dirty = true;
    saveBtn.disabled = false;
    elSaveState.textContent = 'יש שינויים שלא נשמרו';
  }

  function markClean(message) {
    state.dirty = false;
    saveBtn.disabled = true;
    elSaveState.textContent = message || 'הכול שמור';
  }

  /* ───────── שדות ───────── */

  function textField(field, value, onChange) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', null, field.label)).htmlFor = 'f-' + field.key + '-' + Math.random().toString(36).slice(2);
    var input;
    if (field.type === 'textarea') {
      input = el('textarea');
    } else {
      input = el('input');
      input.type = field.type === 'url' ? 'url' : field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'text';
      if (field.type === 'url' || field.type === 'email') input.dir = 'ltr';
    }
    input.id = wrap.querySelector('label').htmlFor;
    input.value = value || '';
    if (field.max) input.maxLength = field.max;

    var counter = el('div', 'counter');
    var updateCounter = function () {
      counter.textContent = field.max ? input.value.length + ' / ' + field.max : '';
    };
    updateCounter();

    input.addEventListener('input', function () {
      updateCounter();
      onChange(input.value);
      markDirty();
    });

    wrap.appendChild(input);
    if (field.max) wrap.appendChild(counter);
    return wrap;
  }

  function listField(field, value, onChange) {
    var items = Array.isArray(value) ? value.slice() : [];
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', null, field.label));
    var rows = el('div');

    function render() {
      rows.textContent = '';
      items.forEach(function (item, index) {
        var row = el('div', 'list__row');
        var input = el('input');
        input.type = 'text';
        input.value = item;
        if (field.max) input.maxLength = field.max;
        input.addEventListener('input', function () {
          items[index] = input.value;
          onChange(items);
          markDirty();
        });
        row.appendChild(input);
        row.appendChild(button('↑', 'btn--ghost btn--sm', function () {
          if (index === 0) return;
          items.splice(index - 1, 0, items.splice(index, 1)[0]);
          onChange(items); markDirty(); render();
        }));
        row.appendChild(button('↓', 'btn--ghost btn--sm', function () {
          if (index === items.length - 1) return;
          items.splice(index + 1, 0, items.splice(index, 1)[0]);
          onChange(items); markDirty(); render();
        }));
        row.appendChild(button('הסרה', 'btn--danger btn--sm', function () {
          items.splice(index, 1);
          onChange(items); markDirty(); render();
        }));
        rows.appendChild(row);
      });
    }
    render();

    wrap.appendChild(rows);
    wrap.appendChild(button('הוספת שורה', 'btn--ghost btn--sm', function () {
      if (field.maxItems && items.length >= field.maxItems) {
        toast('אפשר עד ' + field.maxItems + ' שורות', 'bad');
        return;
      }
      items.push('');
      onChange(items); markDirty(); render();
    }));
    return wrap;
  }

  /* קבצים מקומיים מגיעים כנתיב יחסי, ומהענן ככתובת מלאה */
  function mediaSrc(value) {
    var current = String(value || '');
    return /^https?:\/\//i.test(current) ? current : '/' + current;
  }

  function mediaField(field, value, onChange) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', null, field.label));

    var row = el('div', 'media-field');
    var preview = el('div', 'media-preview');
    var actions = el('div', 'media-actions');
    var pathLabel = el('div', 'media-path');

    function paint(current) {
      preview.textContent = '';
      preview.style.backgroundImage = '';
      if (!current) {
        preview.textContent = 'אין קובץ';
      } else if (field.type === 'video') {
        var video = document.createElement('video');
        video.src = mediaSrc(current);
        video.muted = true;
        video.playsInline = true;
        preview.appendChild(video);
      } else {
        preview.style.backgroundImage = 'url("' + mediaSrc(current).replace(/"/g, '') + '")';
      }
      pathLabel.textContent = current || '';
    }
    paint(value);

    actions.appendChild(button('בחירה מהספרייה', 'btn--ghost btn--sm', function () {
      openMedia(field.type === 'video' ? 'video' : 'image').then(function (picked) {
        if (!picked) return;
        onChange(picked);
        paint(picked);
        markDirty();
      });
    }));
    actions.appendChild(button('ניקוי', 'btn--ghost btn--sm', function () {
      onChange('');
      paint('');
      markDirty();
    }));

    row.appendChild(preview);
    actions.appendChild(pathLabel);
    row.appendChild(actions);
    wrap.appendChild(row);
    return wrap;
  }

  function repeaterField(field, value, onChange) {
    var items = Array.isArray(value) ? value.slice() : [];
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', null, field.label));
    var host = el('div');

    function blank() {
      var item = {};
      field.fields.forEach(function (sub) {
        item[sub.key] = sub.type === 'list' || sub.type === 'repeater' ? [] : '';
      });
      return item;
    }

    function render() {
      host.textContent = '';
      items.forEach(function (item, index) {
        var card = el('div', 'repeat__item');
        var head = el('div', 'repeat__head');
        var title = (field.titleField && item[field.titleField]) || (field.itemLabel + ' ' + (index + 1));
        head.appendChild(el('div', 'repeat__title', title));
        head.appendChild(button('↑', 'btn--ghost btn--sm', function () {
          if (index === 0) return;
          items.splice(index - 1, 0, items.splice(index, 1)[0]);
          onChange(items); markDirty(); render();
        }));
        head.appendChild(button('↓', 'btn--ghost btn--sm', function () {
          if (index === items.length - 1) return;
          items.splice(index + 1, 0, items.splice(index, 1)[0]);
          onChange(items); markDirty(); render();
        }));
        head.appendChild(button('מחיקה', 'btn--danger btn--sm', function () {
          if (!window.confirm('למחוק את "' + title + '"?')) return;
          items.splice(index, 1);
          onChange(items); markDirty(); render();
        }));
        card.appendChild(head);

        field.fields.forEach(function (sub) {
          card.appendChild(buildField(sub, item[sub.key], function (next) {
            item[sub.key] = next;
            onChange(items);
          }));
        });
        host.appendChild(card);
      });
    }
    render();

    wrap.appendChild(host);
    wrap.appendChild(button('הוספת ' + field.itemLabel, 'btn--ghost btn--sm', function () {
      if (field.maxItems && items.length >= field.maxItems) {
        toast('אפשר עד ' + field.maxItems + ' פריטים', 'bad');
        return;
      }
      items.push(blank());
      onChange(items); markDirty(); render();
    }));
    return wrap;
  }

  function buildField(field, value, onChange) {
    if (field.type === 'image' || field.type === 'video') return mediaField(field, value, onChange);
    if (field.type === 'list') return listField(field, value, onChange);
    if (field.type === 'repeater') return repeaterField(field, value, onChange);
    return textField(field, value, onChange);
  }

  /* ───────── ניווט ורינדור ───────── */

  function renderNav() {
    elNav.textContent = '';
    state.sections.forEach(function (section) {
      var node = el('button', section.id === state.activeSection && state.view === 'section' ? 'is-active' : '', section.label);
      node.type = 'button';
      node.addEventListener('click', function () { showSection(section.id); });
      elNav.appendChild(node);
    });
  }

  function showSection(id) {
    state.activeSection = id;
    state.view = 'section';
    renderNav();

    var section = state.sections.find(function (item) { return item.id === id; });
    if (!section) return;
    elTitle.textContent = section.label;
    if (!state.content[section.id]) state.content[section.id] = {};
    var data = state.content[section.id];

    elContent.textContent = '';
    var card = el('div', 'card');
    card.appendChild(el('h2', null, section.label));
    section.fields.forEach(function (field) {
      card.appendChild(buildField(field, data[field.key], function (next) {
        data[field.key] = next;
      }));
    });
    elContent.appendChild(card);
    elContent.scrollTop = 0;
  }

  /* ───────── ספריית מדיה ───────── */

  var media = {
    modal: document.getElementById('mediaModal'),
    grid: document.getElementById('mediaGrid'),
    status: document.getElementById('mediaStatus'),
    upload: document.getElementById('mediaUpload'),
    chooseBtn: document.getElementById('mediaChoose'),
    deleteBtn: document.getElementById('mediaDelete'),
    kind: 'image',
    selected: null,
    inUse: [],
    resolve: null
  };

  function openMedia(kind) {
    media.kind = kind;
    media.selected = null;
    media.chooseBtn.disabled = true;
    media.deleteBtn.disabled = true;
    media.modal.classList.remove('hidden');
    media.upload.accept = kind === 'video' ? 'video/mp4,video/webm' : 'image/*';
    loadMedia();
    return new Promise(function (resolve) { media.resolve = resolve; });
  }

  function closeMedia(result) {
    media.modal.classList.add('hidden');
    if (media.resolve) media.resolve(result || null);
    media.resolve = null;
  }

  function loadMedia() {
    media.status.textContent = 'טוען…';
    return api('GET', '/media').then(function (data) {
      media.inUse = data.inUse || [];
      media.grid.textContent = '';
      var files = (data.media || []).filter(function (file) { return file.kind === media.kind; });
      if (!files.length) {
        media.grid.appendChild(el('p', 'muted', 'עדיין לא הועלו קבצים מסוג זה.'));
      }
      files.forEach(function (file) {
        var tile = el('div', 'media-tile');
        var thumb = el('div', 'media-tile__thumb');
        if (file.kind === 'image') thumb.style.backgroundImage = 'url("' + mediaSrc(file.path).replace(/"/g, '') + '")';
        else thumb.textContent = 'וידאו';
        tile.appendChild(thumb);
        tile.appendChild(el('div', 'media-tile__name', file.name));
        tile.addEventListener('click', function () {
          Array.prototype.forEach.call(media.grid.children, function (node) { node.classList.remove('is-selected'); });
          tile.classList.add('is-selected');
          media.selected = file.path;
          media.chooseBtn.disabled = false;
          media.deleteBtn.disabled = media.inUse.indexOf(file.path) !== -1;
          media.status.textContent = media.inUse.indexOf(file.path) !== -1 ? 'הקובץ בשימוש בעמוד' : '';
        });
        media.grid.appendChild(tile);
      });
      media.status.textContent = '';
    }).catch(function (error) {
      media.status.textContent = error.message;
    });
  }

  media.upload.addEventListener('change', function () {
    var file = media.upload.files && media.upload.files[0];
    if (!file) return;
    var form = new FormData();
    form.append('file', file);
    media.status.textContent = 'מעלים…';
    api('POST', '/media?kind=' + media.kind, form)
      .then(function (data) {
        media.upload.value = '';
        return loadMedia().then(function () {
          media.selected = data.file.path;
          media.chooseBtn.disabled = false;
          media.status.textContent = 'הקובץ הועלה';
        });
      })
      .catch(function (error) {
        media.upload.value = '';
        media.status.textContent = error.message;
      });
  });

  media.chooseBtn.addEventListener('click', function () { closeMedia(media.selected); });
  document.getElementById('mediaClose').addEventListener('click', function () { closeMedia(null); });
  document.getElementById('mediaBtn').addEventListener('click', function () { openMedia('image'); });
  media.modal.addEventListener('click', function (event) {
    if (event.target === media.modal) closeMedia(null);
  });

  media.deleteBtn.addEventListener('click', function () {
    if (!media.selected || !window.confirm('למחוק את הקובץ לצמיתות?')) return;
    api('DELETE', '/media', { path: media.selected })
      .then(function () {
        media.selected = null;
        media.chooseBtn.disabled = true;
        media.deleteBtn.disabled = true;
        return loadMedia();
      })
      .then(function () { media.status.textContent = 'הקובץ נמחק'; })
      .catch(function (error) { media.status.textContent = error.message; });
  });

  /* ───────── גיבויים והגדרות ───────── */

  function showTools() {
    state.view = 'tools';
    renderNav();
    elTitle.textContent = 'גיבויים והגדרות';
    elContent.textContent = '';

    var backups = el('div', 'card');
    backups.appendChild(el('h2', null, 'גיבויים'));
    backups.appendChild(el('p', 'muted', 'כל שמירה יוצרת גיבוי אוטומטי. אפשר לחזור לגרסה קודמת בלחיצה.'));
    var list = el('div');
    backups.appendChild(list);
    backups.appendChild(button('שחזור לתוכן המקורי של האתר', 'btn--ghost btn--sm', function () {
      if (!window.confirm('לשחזר את כל התוכן לגרסת ברירת המחדל?')) return;
      api('POST', '/content/restore-defaults')
        .then(function (data) {
          state.content = data.content;
          markClean('שוחזר תוכן ברירת המחדל');
          toast('התוכן שוחזר', 'ok');
          showTools();
        })
        .catch(function (error) { toast(error.message, 'bad'); });
    }));
    elContent.appendChild(backups);

    api('GET', '/backups').then(function (data) {
      list.textContent = '';
      if (!data.backups.length) {
        list.appendChild(el('p', 'muted', 'אין עדיין גיבויים.'));
        return;
      }
      data.backups.forEach(function (backup) {
        var row = el('div', 'backup-row');
        row.appendChild(el('span', null, new Date(backup.savedAt).toLocaleString('he-IL')));
        row.appendChild(button('שחזור', 'btn--ghost btn--sm', function () {
          if (!window.confirm('לשחזר את הגרסה הזו?')) return;
          api('POST', '/backups/restore', { name: backup.name })
            .then(function (result) {
              state.content = result.content;
              markClean('שוחזרה גרסה קודמת');
              toast('הגרסה שוחזרה', 'ok');
            })
            .catch(function (error) { toast(error.message, 'bad'); });
        }));
        list.appendChild(row);
      });
    }).catch(function (error) { toast(error.message, 'bad'); });

    var passwordCard = el('div', 'card');
    passwordCard.appendChild(el('h2', null, 'שינוי סיסמה'));
    passwordCard.appendChild(el('p', 'muted', 'לאחר השינוי תתבצע התנתקות מכל המכשירים.'));

    var current = el('input'); current.type = 'password'; current.autocomplete = 'current-password';
    var next = el('input'); next.type = 'password'; next.autocomplete = 'new-password';

    [['סיסמה נוכחית', current], ['סיסמה חדשה', next]].forEach(function (pair) {
      var field = el('div', 'field');
      field.appendChild(el('label', null, pair[0]));
      field.appendChild(pair[1]);
      passwordCard.appendChild(field);
    });

    passwordCard.appendChild(button('עדכון סיסמה', 'btn--ghost btn--sm', function () {
      api('POST', '/password', { currentPassword: current.value, newPassword: next.value })
        .then(function () { window.location.replace('/admin/login'); })
        .catch(function (error) { toast(error.message, 'bad'); });
    }));
    elContent.appendChild(passwordCard);
  }

  document.getElementById('toolsBtn').addEventListener('click', showTools);

  /* ───────── שמירה ───────── */

  function save() {
    saveBtn.disabled = true;
    elSaveState.textContent = 'שומרים…';
    api('PUT', '/content', { content: state.content })
      .then(function (data) {
        state.content = data.content;
        markClean('נשמר ופורסם · ' + new Date().toLocaleTimeString('he-IL'));
        toast('התוכן פורסם באתר', 'ok');
        if (state.view === 'section') showSection(state.activeSection);
      })
      .catch(function (error) {
        saveBtn.disabled = false;
        elSaveState.textContent = 'השמירה נכשלה';
        toast(error.message, 'bad');
      });
  }

  saveBtn.addEventListener('click', save);

  reloadBtn.addEventListener('click', function () {
    if (state.dirty && !window.confirm('לבטל את כל השינויים שלא נשמרו?')) return;
    load();
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    if (state.dirty && !window.confirm('יש שינויים שלא נשמרו. להתנתק בכל זאת?')) return;
    api('POST', '/logout').finally(function () { window.location.replace('/admin/login'); });
  });

  window.addEventListener('beforeunload', function (event) {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('keydown', function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      if (state.dirty) save();
    }
    if (event.key === 'Escape' && !media.modal.classList.contains('hidden')) closeMedia(null);
  });

  /* ───────── טעינה ───────── */

  function load() {
    return api('GET', '/session')
      .then(function (data) {
        document.getElementById('sideUser').textContent = 'מחובר: ' + data.user.displayName;
        return Promise.all([api('GET', '/schema'), api('GET', '/content')]);
      })
      .then(function (results) {
        state.sections = results[0].sections;
        state.limits = results[0].limits;
        state.content = results[1].content;
        markClean('הכול שמור');
        showSection(state.activeSection || state.sections[0].id);
      })
      .catch(function (error) {
        if (error.message !== 'unauthorized') toast(error.message, 'bad');
      });
  }

  load();
})();
