const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('admin saves changed subject heads from one button and retains failed changes for retry', async () => {
  class Element {
    constructor() { this.children = []; this.events = {}; this.value = ''; }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    addEventListener(name, fn) { this.events[name] = fn; }
    showModal() {}
    close() {}
  }
  const body = new Element(), host = new Element();
  const all = (node) => [node, ...node.children.flatMap(all)];
  let ready, fail = true;
  const writes = [];
  const data = { subjects: [{ name: 'math', label: 'Math', head: null }, { name: 'physics', label: 'Physics', head: null }], teachers: [{ _id: 'teacher', username: 'Iris' }] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/subject-leadership.js'), 'utf8'), {
    document: { addEventListener: (_, fn) => { ready = fn; }, querySelector: () => host, createElement: () => new Element(), body },
    getPayload: () => ({ role: 'admin' }), getToken: () => 'token', API_BASE_URL: '', Option: Element,
    fetch: async (_, options) => {
      if (options.method === 'PUT') {
        const change = JSON.parse(options.body); writes.push(change.name);
        if (change.name === 'physics' && fail) return { ok: false, json: async () => ({ error: 'Offline' }) };
      }
      return { ok: true, json: async () => data };
    }
  });
  ready(); host.children[0].events.click(); await new Promise(setImmediate);
  const saves = all(body).filter((node) => node.textContent === 'Save changes');
  assert.equal(saves.length, 1);
  assert.equal(all(body).some((node) => node.textContent === 'Save'), false);
  const save = saves[0]; assert.equal(save.disabled, true);
  const fields = all(body).filter((node) => node.events.change);
  fields.forEach((node) => { node.value = 'teacher'; node.events.change(); });
  assert.equal(save.disabled, false);
  await save.events.click(); assert.deepEqual(writes, ['math', 'physics']);
  assert.equal(save.disabled, false);
  fail = false; await save.events.click();
  assert.deepEqual(writes, ['math', 'physics', 'physics']);
  assert.equal(save.disabled, true);
});
