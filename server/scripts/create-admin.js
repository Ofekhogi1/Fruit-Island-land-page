'use strict';

const readline = require('readline');
const { stdin, stdout } = require('process');

const users = require('../lib/users');
const { validateStrength, MIN_LENGTH } = require('../lib/passwords');

function ask(question, { silent = false } = {}) {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  return new Promise((resolve) => {
    if (silent) {
      const onData = (char) => {
        if (['\n', '\r', '\u0004'].includes(String(char))) stdin.removeListener('data', onData);
        else stdout.write('\x1b[2K\x1b[200D' + question + '*'.repeat(rl.line.length));
      };
      stdin.on('data', onData);
    }
    rl.question(question, (answer) => {
      rl.close();
      if (silent) stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

(async () => {
  console.log('יצירת / עדכון משתמש ניהול ל-Fruit Island');
  console.log(`הסיסמה חייבת להיות באורך ${MIN_LENGTH} תווים לפחות ולשלב סוגי תווים שונים.\n`);

  const username = await ask('שם משתמש: ');
  const password = await ask('סיסמה: ', { silent: true });
  const confirm = await ask('אימות סיסמה: ', { silent: true });

  if (password !== confirm) {
    console.error('\nהסיסמאות אינן תואמות.');
    process.exit(1);
  }
  const weak = validateStrength(password);
  if (weak) {
    console.error(`\n${weak}`);
    process.exit(1);
  }

  try {
    const user = await users.upsertUser(username, password);
    console.log(`\nהמשתמש "${user.username}" נשמר בהצלחה בקובץ ${users.usersFile}`);
    console.log('התחברו בכתובת /admin');
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }
})();
