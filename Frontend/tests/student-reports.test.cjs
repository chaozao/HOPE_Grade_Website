const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('attendance cascades filters, sorts names, cycles marks and ignores stale rosters', async () => {
  class Element {
    constructor(text = '', value = '') { this.textContent = text; this.value = value; this.children = []; this.events = {}; this.dataset = {}; }
    replaceChildren(...nodes) { this.children = nodes; this.value = ''; }
    appendChild(node) { this.children.push(node); }
    addEventListener(name, fn) { this.events[name] = fn; }
    setAttribute() {}
    get firstElementChild() { return this.children[0]; }
    querySelectorAll() { return []; }
  }
  const elements = new Map();
  const el = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  let start, resolveRoster;
  const saved = [];
  let failSave = false;
  const subject = { _id: 's1', classId: 'c1', gradeLevel: '', gradeLevels: ['Grade 7'], section: 'Emerald', name: 'Physics' };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/student-reports.js'), 'utf8'), {
    document: { getElementById: el, addEventListener: (_, fn) => { start = fn; } },
    window: { addEventListener() {} }, location: { hash: '#student-reports' }, Option: Element,
    AcademicUI: {
      api: async (url, options) => {
        if (options?.method === 'PUT') {
          if (failSave) throw new Error('Offline');
          saved.push(JSON.parse(options.body));
          return saved.at(-1);
        }
        return url.endsWith('my-subjects') ? [subject] : new Promise((resolve) => { resolveRoster = resolve; });
      },
      node: (_, text) => new Element(text),
      empty: (body, text) => body.appendChild(new Element(text)),
      row: (body, cells) => body.appendChild({ cells })
    }
  });
  start();
  await new Promise(setImmediate);
  const grade = el('attendance-grade'), section = el('attendance-section'), subjectSelect = el('attendance-subject');
  assert.equal(grade.children[1].value, 'Grade 7');
  grade.value = 'Grade 7'; grade.events.change();
  assert.equal(section.disabled, false);
  assert.equal(section.children[1].value, 'c1');
  assert.equal(subjectSelect.disabled, true);
  section.value = 'c1'; section.events.change();
  assert.equal(subjectSelect.disabled, false);
  assert.equal(subjectSelect.children[1].value, 's1');
  subjectSelect.value = 's1'; const pending = subjectSelect.events.change();
  resolveRoster({ roster: [ { studentId: '1', lastName: 'Zulu', firstName: 'Ana' }, { studentId: '2', lastName: 'Alba', firstName: 'Ben' }, ...Array.from({ length: 7 }, (_, i) => ({ studentId: 'extra' + i, lastName: 'Middle' + i, firstName: 'A' })) ] });
  await pending;
  const rows = el('attendance-students').children;
  assert.equal(rows[0].cells[0], 'Alba, Ben');
  const button = rows[0].cells[1];
  for (const state of ['unmarked', 'absent', 'present', 'tardy', 'unmarked']) {
    assert.equal(button.className, 'attendance-action is-' + state);
    await button.events.click();
  }
  assert.equal(saved.length, 0, 'clicking a status must not make a save request');
  assert.equal(rows.length, 8);
  el('attendance-next').events.click();
  assert.equal(el('attendance-students').children.length, 1);
  el('attendance-students').children[0].cells[1].events.click();
  el('attendance-prev').events.click();
  assert.equal(el('attendance-students').children[0].cells[1].className, 'attendance-action is-absent');
  await el('attendance-save').events.click();
  assert.equal(saved.length, 2, 'save includes drafts from both pages');
  assert.equal(el('attendance-save').disabled, true);
  assert.equal(saved[0].date, el('attendance-date').value);
  assert.equal(saved[0].status, 'absent');
  failSave = true;
  const currentButton = el('attendance-students').children[0].cells[1];
  currentButton.events.click();
  assert.equal(currentButton.className, 'attendance-action is-present');
  await el('attendance-save').events.click();
  assert.equal(el('attendance-students').children[0].cells[1].className, 'attendance-action is-present');
  assert.equal(el('attendance-save').disabled, false);
  assert.match(el('attendance-status').textContent, /not saved/);
  failSave = false;
  await el('attendance-save').events.click();
  el('attendance-date').value = '2026-10-01';
  const changeDate = el('attendance-date').events.change();
  resolveRoster({ roster: [{ studentId: '2', lastName: 'Alba', firstName: 'Ben', status: 'tardy' }] });
  await changeDate;
  assert.equal(el('attendance-students').children[0].cells[1].className, 'attendance-action is-tardy');
  const stale = subjectSelect.events.change();
  grade.value = ''; grade.events.change();
  assert.equal(section.disabled, true);
  assert.equal(subjectSelect.disabled, true);
  resolveRoster({ roster: [{ studentId: '1', lastName: 'Old', firstName: 'Result' }] });
  await stale;
  assert.match(el('attendance-students').children[0].textContent, /Select a grade level/);
});
