const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}
function tab(localStorage = storage()) {
  const events = {};
  const redirects = [];
  const context = vm.createContext({
    localStorage, sessionStorage: storage(),
    atob: value => Buffer.from(value, 'base64').toString(),
    window: {
      addEventListener: (name, callback) => { events[name] = callback; },
      location: { replace: url => redirects.push(url) }
    }
  });
  vm.runInContext(source, context);
  return Object.assign(context, { events, redirects });
}
const token = (role = 'admin', isAdviser = false, exp = Math.floor(Date.now() / 1000) + 3600) =>
  'test.' + Buffer.from(JSON.stringify({ role, isAdviser, exp })).toString('base64') + '.test';

test('login is shared across tabs with or without Remember me; private storage is separate', () => {
  for (const remember of [false, true]) {
    const first = tab();
    first.saveToken(token(), remember);
    const second = tab(first.localStorage);
    assert.equal(second.getToken(), first.getToken());
    assert.equal(second.redirectSignedInUser(), true);
    assert.deepEqual(second.redirects, ['admin-dashboard.html']);
    assert.equal(tab().getToken(), null);
  }
});
test('legacy tab session migrates and cannot override a shared account', () => {
  const first = tab();
  first.sessionStorage.setItem('token', token('teacher'));
  assert.equal(first.getToken(), first.localStorage.getItem('token'));
  assert.equal(first.sessionStorage.getItem('token'), null);
  first.sessionStorage.setItem('token', token('teacher'));
  first.localStorage.setItem('token', token());
  assert.equal(first.getToken(), token());
});
test('logout clears other tabs and their stale workspace hints', () => {
  const first = tab();
  first.saveToken(token());
  const second = tab(first.localStorage);
  second.sessionStorage.setItem('token', token());
  second.sessionStorage.setItem('workspace-hint', 'old');
  first.clearToken();
  second.events.storage({ storageArea: first.localStorage, key: 'token' });
  assert.equal(second.getToken(), null);
  assert.equal(second.sessionStorage.getItem('workspace-hint'), null);
  assert.deepEqual(second.redirects, ['index.html']);
});
test('login redirects follow roles and reject expired or malformed sessions', () => {
  for (const [role, adviser, destination] of [
    ['admin', false, 'admin-dashboard.html'],
    ['teacher', true, 'class-advisor.html'],
    ['teacher', false, 'dashboard.html']
  ]) {
    const current = tab();
    current.saveToken(token(role, adviser));
    assert.equal(current.redirectSignedInUser(), true);
    assert.equal(current.redirects[0], destination);
  }
  for (const invalid of ['broken', token('admin', false, 1)]) {
    const current = tab();
    current.saveToken(invalid);
    assert.equal(current.redirectSignedInUser(), false);
    assert.equal(current.getToken(), null);
  }
});
