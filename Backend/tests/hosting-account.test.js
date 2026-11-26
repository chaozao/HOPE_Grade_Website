const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const createAvatarUpload = require('../middleware/avatar-upload');
const { createPasswordMail, logMailError } = require('../services/password-mail');

test('photo uploads create missing storage and return JSON for oversized and invalid files', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hope-avatar-'));
  const directory = path.join(root, 'avatars');
  t.after(() => {
    if (fs.existsSync(directory)) {
      for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
      fs.rmdirSync(directory);
    }
    fs.rmdirSync(root);
  });
  const app = express();
  app.post('/me/photo', (req, res, next) => { req.user = { userId: 'test-user' }; next(); },
    createAvatarUpload(directory), (req, res) => res.json({ stored: Boolean(req.file) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  async function upload(size, type = 'image/png') {
    const body = new FormData();
    body.append('photo', new Blob([new Uint8Array(size)], { type }), 'photo.png');
    return fetch('http://127.0.0.1:' + server.address().port + '/me/photo', { method: 'POST', body });
  }
  const ok = await upload(25 * 1024 * 1024);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).stored, true);
  assert.equal(fs.readdirSync(directory).length, 1);
  const large = await upload(25 * 1024 * 1024 + 1);
  assert.equal(large.status, 413);
  assert.match((await large.json()).error, /25 MB/);
  const invalid = await upload(10, 'text/plain');
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /image/);
  t.mock.method(fs, 'mkdir', (folder, options, done) => done(Object.assign(new Error('private path'), { code: 'EACCES' })));
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const denied = await upload(20);
  assert.equal(denied.status, 503);
  assert.equal((await denied.json()).code, 'EACCES');
  assert.deepEqual(logs, ['[photo-upload] EACCES']);
});

test('Gmail transport normalizes credentials, supports TLS ports, and builds hosted reset links', async () => {
  for (const port of [465, 587]) {
    let options, message;
    const mail = createPasswordMail({ GMAIL_USER: ' sender@example.test ', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
      FRONTEND_URL: 'https://example.test/gradebook/', GMAIL_SMTP_PORT: String(port) }, config => {
      options = config;
      return { verify: async () => true, sendMail: async input => { message = input; } };
    });
    await mail.verify();
    await mail.send('recipient@example.test', 'test-token');
    assert.equal(options.auth.pass, 'abcdefghijklmnop');
    assert.equal(options.auth.user, 'sender@example.test');
    assert.equal(options.secure, port === 465);
    assert.equal(options.requireTLS, true);
    assert.match(message.text, /https:\/\/example.test\/gradebook\/reset-password.html\?token=test-token/);
  }
  assert.throws(() => createPasswordMail({}), { code: 'MAIL_CONFIG' });
});

function resetFixture({ verifyError, sendError, exists = true } = {}) {
  let lookups = 0, saved = 0, sent = 0;
  const user = { email: 'test@example.test', save: async () => { saved++; } };
  const handlers = {};
  const app = { use() {}, get() {}, put() {}, patch() {}, delete() {}, listen() {}, post(route, ...functions) { handlers[route] = functions.at(-1); } };
  const fakeExpress = Object.assign(() => app, { json() {}, static() {} });
  const mail = { verify: async () => { if (verifyError) throw verifyError; }, send: async () => { sent++; if (sendError) throw sendError; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
    __dirname: path.resolve(__dirname, '..'), process: { env: {} }, console: { log() {}, error() {} }, URL,
    require(name) {
      if (['path', 'crypto'].includes(name)) return require(name);
      if (name === 'dotenv') return { config() {} };
      if (name === 'express') return fakeExpress;
      if (name === 'cors') return () => {};
      if (name === 'mongoose') return { connect: async () => {} };
      if (name === './models/User') return { findOne: async () => { lookups++; return exists ? user : null; } };
      if (name === './services/password-mail') return { createPasswordMail: () => mail, logMailError() {} };
      if (name === './middleware/avatar-upload') return () => () => {};
      if (name === './middleware/auth') return { verifyToken() {}, requireRole: () => () => {} };
      return {};
    }
  });
  return { user, counts: () => ({ lookups, saved, sent }), async request() {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
    await handlers['/forget-password']({ body: { email: 'test@example.test' } }, res);
    return res;
  } };
}

test('SMTP failures return 503 before account lookup, without modifying reset tokens', async () => {
  const fixture = resetFixture({ verifyError: { code: 'EAUTH' } });
  assert.equal((await fixture.request()).statusCode, 503);
  assert.deepEqual(fixture.counts(), { lookups: 0, saved: 0, sent: 0 });
});

test('reset saves a hashed expiring token and keeps recipient-specific responses private', async () => {
  const known = resetFixture();
  const a = await known.request();
  assert.equal(a.statusCode, 200);
  assert.deepEqual(known.counts(), { lookups: 1, saved: 1, sent: 1 });
  assert.match(known.user.resetTokenHash, /^[a-f0-9]{64}$/);
  assert.ok(known.user.resetTokenExpiry.getTime() > Date.now());
  const unknown = resetFixture({ exists: false });
  const b = await unknown.request();
  const failed = await resetFixture({ sendError: { code: 'EENVELOPE' } }).request();
  assert.equal(a.body.message, b.body.message);
  assert.equal(a.body.message, failed.body.message);
  assert.equal(unknown.counts().sent, 0);
});

test('mail diagnostics never print provider messages or credentials', t => {
  const output = [];
  t.mock.method(console, 'error', (...args) => output.push(args.join(' ')));
  logMailError({ code: 'EAUTH', message: 'secret credentials', response: 'private address' });
  logMailError({ code: 'private address' });
  assert.deepEqual(output, ['[password-mail] EAUTH', '[password-mail] MAIL_FAILED']);
});
