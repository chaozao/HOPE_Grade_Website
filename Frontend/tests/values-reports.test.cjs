const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('values editor identifies the student, preserves drafts and saves only the selected term/category', async () => {
  class Element {
    constructor(text = '', value = '') { this.textContent = text; this.value = value; this.children = []; this.events = {}; this.classList = { toggle() {} }; }
    replaceChildren(...nodes) { this.children = nodes; }
    appendChild(node) { this.children.push(node); }
    addEventListener(event, fn) { this.events[event] = fn; }
    setAttribute() {}
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    querySelectorAll() { return this.children.flatMap((row) => row.cells || []).filter((cell) => cell instanceof Element); }
    get selectedOptions() { return [{ textContent: '2nd Term' }]; }
  }
  const elements = new Map();
  const el = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  let start, saved, fails = false;
  const context = { document: { getElementById: el, addEventListener: (_, fn) => { start = fn; } },
    window: { addEventListener() {} }, location: { hash: '#student-reports' }, Option: Element,
    AcademicUI: {
      node: (_, text) => new Element(text), button: (text, fn) => { const button = new Element(text); button.events.click = fn; return button; },
      row: (body, cells) => { const row = { cells, children: cells.map(() => ({})) }; body.appendChild(row); return row; }, empty: (body, text) => body.appendChild(new Element(text)),
      api: async (url, options) => {
        if (options?.method === 'PUT') { if (fails) throw new Error('Offline'); saved = JSON.parse(options.body); return saved; }
        if (url.endsWith('report-subjects')) return [{ _id: 's', classId: 'c', gradeLevels: ['Grade 7'], name: 'Science', section: 'Emerald' }];
        return { roster: [{ studentId: 'a', lastName: 'Alba', firstName: 'Ben', reports: [] }] };
      }
    }
  };
  vm.createContext(context);
  for (const file of ['core-values.js', 'values-reports.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
  start(); await new Promise(setImmediate);
  el('values-grade').value = 'Grade 7'; el('values-grade').events.change();
  el('values-section').value = 'c'; el('values-section').events.change();
  el('values-subject').value = 's'; el('values-term').value = '2';
  await el('values-subject').events.change();
  const open = () => el('values-students').children[0].cells[2].events.click();
  open();
  assert.equal(el('values-dialog-title').textContent, 'Alba, Ben');
  assert.equal(el('values-dialog-body').children.length, 7);
  const groupedRows = el('values-dialog-body').children;
  assert.equal(groupedRows[0].children[0].rowSpan, 2);
  assert.equal(groupedRows[1].cells.length, 4);
  assert.equal(groupedRows[1].children[1].className, 'values-term-cell');
  assert.equal(groupedRows[2].children[0].rowSpan, 2);
  assert.equal(groupedRows[4].children[0].rowSpan, 1);
  assert.equal(groupedRows[5].children[0].rowSpan, 2);
  const row = el('values-dialog-body').children[0];
  assert.equal(typeof row.cells[2], 'string');
  assert.equal(row.cells[3].children.length, 5);
  assert.equal(row.cells[3].children[1].value, 'AO');
  row.cells[3].value = 'AO'; row.cells[3].events.change();
  el('values-close').events.click(); open();
  assert.equal(el('values-dialog-body').children[0].cells[3].value, 'AO');
  fails = true; await el('values-save').events.click();
  assert.equal(el('values-save').disabled, false);
  fails = false; await el('values-save').events.click();
  assert.equal(saved.term, 2); assert.equal(saved.category, 'filipino'); assert.equal(saved.ratings.faith, 'AO');
  assert.equal(el('values-save').disabled, true);
  el('values-close').events.click(); el('values-personal').events.click(); open();
  assert.equal(el('values-dialog-body').children.length, 8);
  assert.equal(el('values-dialog-body').children[0].cells[3].value, '');
});
