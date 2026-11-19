const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('narrative drafts survive pagination and failed saves, then save across pages', async () => {
  class Element {
    constructor(text = '', value = '') { this.textContent = text; this.value = value; this.children = []; this.events = {}; }
    replaceChildren(...nodes) { this.children = nodes; this.value = ''; }
    appendChild(node) { this.children.push(node); }
    addEventListener(event, handler) { this.events[event] = handler; }
    setAttribute() {}
  }
  const elements = new Map();
  const el = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  let start, fails = true;
  const saved = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/narrative-reports.js'), 'utf8'), {
    document: { getElementById: el, addEventListener: (_, fn) => { start = fn; } },
    window: { addEventListener() {} }, location: { hash: '#student-reports' }, Option: Element,
    AcademicUI: {
      node: (_, text) => new Element(text), empty: (body, text) => body.appendChild(new Element(text)),
      row: (body, cells) => body.appendChild({ cells }),
      api: async (url, options) => {
        if (options?.method === 'PUT') {
          if (fails) throw new Error('Offline');
          saved.push(JSON.parse(options.body)); return {};
        }
        if (url.endsWith('report-subjects')) return [{ _id: 's', classId: 'c', gradeLevels: ['Grade 7'], name: 'Physics' }];
        return { roster: Array.from({ length: 9 }, (_, i) => ({ studentId: String(i), lastName: 'Name' + i, firstName: 'Ben', canDo: '', improving: '' })) };
      }
    }
  });
  start(); await new Promise(setImmediate);
  el('narrative-grade').value = 'Grade 7'; el('narrative-grade').events.change();
  el('narrative-section').value = 'c'; el('narrative-section').events.change();
  el('narrative-subject').value = 's'; el('narrative-term').value = '2';
  await el('narrative-subject').events.change();
  assert.equal(el('narrative-status').textContent, '');
  const input = el('narrative-students').children[0].cells[1];
  input.value = 'Can read.\nCan write.'; input.events.input();
  el('narrative-next').events.click();
  const other = el('narrative-students').children[0].cells[2];
  other.value = 'Practicing teamwork.'; other.events.input();
  el('narrative-prev').events.click();
  assert.equal(el('narrative-students').children[0].cells[1].value, input.value);
  await el('narrative-save').events.click();
  assert.match(el('narrative-status').textContent, /not saved/);
  assert.equal(el('narrative-save').disabled, false);
  fails = false; await el('narrative-save').events.click();
  assert.equal(saved.length, 2);
  assert.equal(saved[0].term, 2);
  assert.equal(saved[0].canDo, input.value);
  assert.equal(saved[1].improving, other.value);
  assert.equal(el('narrative-save').disabled, true);
});
