(function () {
  'use strict';

  var isSetup = document.body.dataset.mode === 'setup';
  var form = document.getElementById('authForm');
  var alertBox = document.getElementById('alert');
  var submitBtn = document.getElementById('submitBtn');

  function showError(message) {
    alertBox.textContent = message;
    alertBox.classList.remove('hidden');
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    alertBox.classList.add('hidden');

    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value;

    if (isSetup && password !== document.getElementById('confirm').value) {
      showError('הסיסמאות אינן תואמות');
      return;
    }

    submitBtn.disabled = true;
    fetch(isSetup ? '/api/admin/setup' : '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          showError(result.data.error || 'ההתחברות נכשלה');
          submitBtn.disabled = false;
          return;
        }
        window.location.replace('/admin');
      })
      .catch(function () {
        showError('אין תקשורת עם השרת');
        submitBtn.disabled = false;
      });
  });
})();
