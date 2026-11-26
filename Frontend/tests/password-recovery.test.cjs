const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('password recovery shows API failures and allows retry instead of claiming success', async () => {
  for (const response of [
    { ok: false, json: async () => ({ error: 'Password reset email is temporarily unavailable.' }) },
    { ok: false, json: async () => { throw new Error('HTML hosting error'); } },
    { ok: true, json: async () => ({ message: 'If an account exists, a reset email has been requested.' }) }
  ]) {
    let submit;
    const form = { hidden: false, addEventListener: (name, handler) => { submit = handler; } };
    const button = {}, banner = {}, subtitle = { hidden: false };
    const elements = { 'forgot-form': form, 'email': { value: 'test@example.test' }, 'submit-btn': button,
      'form-banner': banner, 'form-subtitle': subtitle };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/forget-password.js'), 'utf8'), {
      API_BASE_URL: 'https://example.test/grading-api',
      document: { addEventListener: (name, handler) => handler(), getElementById: id => elements[id] },
      fetch: async url => { assert.equal(url, 'https://example.test/grading-api/forget-password'); return response; }
    });
    await submit({ preventDefault() {} });
    assert.equal(form.hidden, response.ok);
    assert.equal(subtitle.hidden, response.ok);
    assert.equal(banner.hidden, false);
    if (!response.ok) {
      assert.equal(button.disabled, false);
      assert.match(banner.className, /auth-banner-error/);
    }
  }
});
