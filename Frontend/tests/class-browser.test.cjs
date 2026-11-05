const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag, text = '') {
    this.tag = tag;
    this.text = text;
    this.children = [];
    this.events = {};
    this.classList = { toggle() {} };
  }
  append(...nodes) {
    nodes.forEach((node) => { node.remove(); node.parent = this; });
    this.children.push(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this);
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  setAttribute() {}
  focus() {}
  setPointerCapture() {}
  getBoundingClientRect() {
    return { left: 100, right: 500, top: 100, bottom: 400 };
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  reportValidity() {
    return true;
  }
  addEventListener(type, handler) {
    this.events[type] = handler;
  }
  get textContent() {
    return this.text + this.children.map((node) => node.textContent).join('');
  }
  set textContent(value) {
    this.text = value;
    this.children = [];
  }
  get firstElementChild() {
    return this.children[0];
  }
  get firstChild() {
    const element = this;
    return { set textContent(value) { element.text = value; } };
  }
  get value() {
    return this.selection ?? this.children[0]?.value;
  }
  set value(value) {
    this.selection = value;
  }
  get selectedOptions() {
    return this.children.filter((node) => node.value === this.value);
  }
}
const findAll = (root, check) =>
  [root, ...root.children.flatMap((child) => findAll(child, check))].filter(check);
const byId = (root, id) => findAll(root, (node) => node.id === id)[0];
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture(api) {
  const context = {
    window: {},
    Node: Element,
    document: { createElement: (tag) => new Element(tag) },
    Option: function (text, value) {
      const el = new Element('option', text);
      el.value = value;
      return el;
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/academic-ui.js'), 'utf8'), context);
  context.AcademicUI = context.window.AcademicUI;
  context.AcademicUI.api = api;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/term-grades.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/class-browser.js'), 'utf8'), context);
  const root = new Element('div'),
    browser = context.window.ClassBrowser.create(root);
  browser.setSubjects([{ _id: 'science', name: 'Science', className: 'Grade 7', studentCount: 0 }]);
  return { root, browser, context };
}

test('enrollment totals refresh and term tables sort names without reusing legacy grades', async () => {
  const data = {
    totalStudents: 2,
    passingRate: 100,
    roster: [
      { lastName: 'Zulu', firstName: 'Ana', middleName: 'Lee', lrn: '002', weightedGrade: 99 },
      { lastName: 'alpha', firstName: 'Ben', lrn: '001', weightedGrade: 85 }
    ]
  };
  const { root, browser } = fixture(async () => data);
  await browser.show();
  assert.equal(byId(root, 'class-subjects-tbody').children[0].children[2].textContent, '2');
  findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
  await flush();
  let body = byId(root, 'class-grades-tbody');
  assert.equal(body.children[0].children[1].textContent, 'alpha, Ben');
  assert.equal(body.children[1].children[1].textContent, 'Zulu, Ana Lee');
  assert.equal(body.children[0].children.length, 16);
  assert.equal(body.children[0].children[14].textContent, '—');
  const select = byId(root, 'class-term-select');
  for (const value of ['2', '3', '4']) {
    select.value = value;
    select.events.change();
  }
  body = byId(root, 'class-grades-tbody');
  assert.equal(body.children[0].children.length, 7);
  assert.equal(body.children[0].children[6].textContent, 'Incomplete');
  data.totalStudents = 3;
  await browser.show();
  assert.equal(byId(root, 'class-subjects-tbody').children[0].children[2].textContent, '3');
});

test('failed summaries offer retry and empty rosters show an enrollment message', async () => {
  let fail = true;
  const { root, browser } = fixture(async () => {
    if (fail) throw new Error('Offline');
    return { totalStudents: 0, passingRate: null, roster: [] };
  });
  await browser.show();
  assert.equal(byId(root, 'class-browser-retry').hidden, false);
  fail = false;
  await byId(root, 'class-browser-retry').events.click();
  assert.equal(byId(root, 'class-browser-status').hidden, true);
  findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
  await flush();
  assert.match(byId(root, 'class-grades-tbody').textContent, /No students enrolled/);
  assert.equal(byId(root, 'class-grades-tbody').firstElementChild.firstElementChild.colSpan, 16);
});

test('final grades average all three terms and require every grade, including valid zero scores', async () => {
  for (const [values, expected, remark] of [
    [[80, 85, 90], '85', 'Passed'],
    [[80, 80, 81], '80.3', 'Passed'],
    [[0, 75, 75], '50', 'Failed'],
    [[80, 90, null], '—', 'Incomplete'],
    [[80, 90, undefined], '—', 'Incomplete'],
    [[80, 90, '90'], '—', 'Incomplete'],
    [[80, 90, NaN], '—', 'Incomplete'],
    [[80, 90, 101], '—', 'Incomplete']
  ]) {
    const terms = Object.fromEntries(values.map((termGrade, index) => [index + 1, { termGrade }]));
    const { root, browser } = fixture(async () => ({
      totalStudents: 1,
      passingRate: null,
      roster: [{ lastName: 'Santos', firstName: 'Ana', terms, finalGrade: 100 }]
    }));
    await browser.show();
    findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
    await flush();
    const select = byId(root, 'class-term-select');
    select.value = '4';
    select.events.change();
    const cells = byId(root, 'class-grades-tbody').firstElementChild.children;
    assert.equal(cells[4].textContent, expected);
    assert.equal(cells[6].textContent, remark);
  }
});

test('activities add numbered columns only to their category and term and survive reload', async () => {
  const data = {
    totalStudents: 1,
    gradeVersion: 0,
    gradeStatus: 'draft',
    activities: [],
    roster: [{ firstName: 'Ana', lastName: 'Santos' }]
  };
  const { root, browser } = fixture(async (url, options) => {
    if (options?.method === 'POST') {
      const input = JSON.parse(options.body);
      assert.equal(input.term, 1);
      assert.equal(input.category, 'writtenOral');
      assert.equal(input.maxScore, 5);
      data.activities.push({ ...input, _id: String(data.activities.length + 1) });
      return { activities: data.activities, gradeVersion: ++data.gradeVersion };
    }
    return data;
  });
  async function open() {
    await browser.show();
    findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
    await flush();
  }
  await open();
  for (let number = 1; number <= 6; number++) {
    findAll(
      root,
      (node) => node.tag === 'button' && node.textContent === '+ Add column'
    )[0].events.click();
    const form = findAll(
      root,
      (node) => node.tag === 'form' && node.className === 'activity-editor'
    )[0];
    const inputs = findAll(form, (node) => node.tag === 'input');
    inputs[0].value = 'Written Work ' + number;
    inputs[1].value = '5';
    await form.events.submit({ preventDefault() {} });
  }
  assert.equal(byId(root, 'class-grades-tbody').firstElementChild.children.length, 21);
  await open();
  assert.equal(byId(root, 'class-grades-tbody').firstElementChild.children.length, 21);
  assert.match(root.textContent, /Written Work 6/);
  const select = byId(root, 'class-term-select');
  select.value = '2';
  select.events.change();
  assert.equal(byId(root, 'class-grades-tbody').firstElementChild.children.length, 16);
  select.value = '4';
  select.events.change();
  assert.equal(
    findAll(root, (node) => node.tag === 'button' && node.textContent === '+ Add column').length,
    0
  );
  data.gradeStatus = 'finalized';
  await open();
  assert.ok(
    findAll(root, (node) => node.tag === 'button' && node.textContent === '+ Add column').every(
      (button) => button.disabled
    )
  );
});

test('manager Undo restores only its row and is enabled only for changed values', async () => {
  const data = { totalStudents: 0, gradeVersion: 0, roster: [], activities: [
    { _id: 'a', term: 1, category: 'writtenOral', title: 'Work 1', maxScore: 50 },
    { _id: 'b', term: 1, category: 'writtenOral', title: 'Work 2', maxScore: 100 }
  ] };
  const { root, browser } = fixture(async () => data);
  await browser.show();
  findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
  await flush();
  findAll(root, (node) => node.tag === 'button' && node.textContent === 'Manage columns')[0].events.click();
  const category = byId(root, 'activity-manager-category');
  category.value = 'writtenOral';
  category.events.change();
  const manager = findAll(root, (node) => node.className === 'activity-manager')[0];
  const inputs = findAll(manager, (node) => node.tag === 'input');
  const undo = findAll(manager, (node) => node.className?.includes('activity-undo'));
  assert.deepEqual(undo.map((button) => button.disabled), [true, true]);
  assert.equal(findAll(manager, (node) => node.textContent === 'Edit').length, 0);
  inputs[0].value = 'Changed';
  inputs[0].events.input();
  assert.deepEqual(undo.map((button) => button.disabled), [false, true]);
  inputs[1].value = '75';
  inputs[1].events.input();
  inputs[2].value = 'Other change';
  inputs[2].events.input();
  undo[0].events.click();
  assert.equal(inputs[0].value, 'Work 1');
  assert.equal(inputs[1].value, '50');
  assert.equal(inputs[2].value, 'Other change');
  assert.deepEqual(undo.map((button) => button.disabled), [true, false]);
  inputs[2].value = 'Work 2';
  inputs[2].events.input();
  assert.equal(undo[1].disabled, true);
  inputs[1].value = '';
  inputs[1].events.input();
  assert.equal(undo[0].disabled, false);
  undo[0].events.click();
  assert.equal(inputs[1].value, '50');
  assert.equal(undo[0].disabled, true);
  const dialog = findAll(root, (node) => node.tag === 'dialog')[0];
  dialog.events.pointerdown({ target: dialog, clientX: 120, clientY: 120 });
  dialog.events.click({ target: dialog, clientX: 120, clientY: 120 });
  assert.equal(dialog.open, true);
  dialog.events.pointerdown({ target: dialog, clientX: 20, clientY: 20 });
  dialog.events.click({ target: dialog, clientX: 20, clientY: 20 });
  assert.equal(dialog.open, false);
});

test('deletion is staged, undoable and discarded on cancel; Save commits it and supports retry', async () => {
  const data = { totalStudents: 0, roster: [], gradeVersion: 3, activities: [
    { _id: 'a', term: 1, category: 'writtenOral', title: 'Work 1', maxScore: 50 },
    { _id: 'b', term: 1, category: 'writtenOral', title: 'Work 2', maxScore: 100 }
  ] };
  let fail = true, writes = 0;
  const { root, browser } = fixture(async (url, options) => {
    if (options) {
      writes++;
      assert.equal(options.method, 'DELETE');
      assert.ok(url.endsWith('/activities/a'));
      assert.equal(JSON.parse(options.body).version, 3);
      if (fail) throw new Error('Offline');
      data.activities = data.activities.filter((item) => item._id !== 'a');
      return { activities: data.activities, gradeVersion: 4 };
    }
    return data;
  });
  await browser.show();
  findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
  await flush();
  assert.equal(findAll(root, (node) => node.className?.includes('activity-delete')).length, 0);
  function open() {
    findAll(root, (node) => node.textContent === 'Manage columns')[0].events.click();
    const category = byId(root, 'activity-manager-category');
    category.value = 'writtenOral';
    category.events.change();
    return findAll(root, (node) => node.className === 'activity-manager')[0];
  }
  let manager = open();
  const button = (type) => findAll(manager, (node) => node.className?.includes(type))[0];
  button('activity-delete').events.click();
  assert.equal(writes, 0);
  assert.equal(data.activities.length, 2);
  assert.equal(button('activity-delete').textContent, 'Pending deletion');
  assert.equal(button('activity-undo').disabled, false);
  button('activity-undo').events.click();
  assert.equal(button('activity-delete').textContent, 'Delete');
  assert.equal(button('activity-undo').disabled, true);
  button('activity-delete').events.click();
  findAll(manager, (node) => node.textContent === 'Cancel')[0].events.click();
  manager = open();
  assert.equal(button('activity-delete').textContent, 'Delete');
  assert.equal(writes, 0);
  button('activity-delete').events.click();
  await manager.onsubmit({ preventDefault() {} });
  assert.match(manager.textContent, /Offline/);
  assert.equal(data.activities.length, 2);
  assert.equal(button('activity-undo').disabled, false);
  fail = false;
  await manager.onsubmit({ preventDefault() {} });
  assert.equal(writes, 2);
  assert.equal(data.activities.length, 1);
  assert.equal(findAll(root, (node) => node.className === 'activity-max activity-summary')[0].textContent, '100');
  assert.equal(findAll(root, (node) => node.tag === 'dialog')[0].open, false);
});

test('manager saves edited columns using the latest version and keeps toolbar controls ordered', async () => {
  const data = {
    gradeVersion: 2,
    totalStudents: 0,
    roster: [],
    activities: [
      { _id: 'a', term: 1, category: 'writtenOral', title: 'WS 1', maxScore: 5 },
      { _id: 'b', term: 1, category: 'examination', title: 'Exam', maxScore: 20, wsPercentage: 100 }
    ]
  };
  let saves = 0;
  const { root, browser } = fixture(async (url, options) => {
    if (options) {
      const input = JSON.parse(options.body);
      assert.equal(input.version, 2 + saves++);
      const activity = data.activities.find((item) => url.endsWith('/' + item._id));
      activity.title = input.title;
      activity.maxScore = input.maxScore;
      return { activities: data.activities, gradeVersion: ++data.gradeVersion };
    }
    return data;
  });
  await browser.show();
  findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
  await flush();
  const actions = findAll(root, (node) => node.className === 'class-toolbar-actions')[0];
  assert.equal(actions.children[0].textContent, 'Manage columns');
  assert.equal(actions.children[1].tag, 'label');
  actions.children[0].events.click();
  const manager = findAll(root, (node) => node.className === 'activity-manager')[0];
  const categorySelect = byId(manager, 'activity-manager-category');
  assert.deepEqual(categorySelect.children.map((option) => option.textContent), [
    'Choose an activity category', 'Written / Oral Works', 'Product / Performance Tasks', 'Examinations'
  ]);
  const groups = findAll(manager, (node) => node.className === 'activity-manager-group');
  assert.equal(categorySelect.value, '');
  assert.deepEqual(groups.map((group) => group.hidden), [true, true, true]);
  const commit = findAll(manager, (node) => node.tag === 'button' && node.textContent === 'Save changes')[0];
  assert.equal(commit.hidden, true);
  await manager.onsubmit({ preventDefault() {} });
  assert.equal(saves, 0);
  categorySelect.value = 'writtenOral';
  categorySelect.events.change();
  assert.equal(commit.hidden, false);
  assert.deepEqual(groups.map((group) => group.hidden), [false, true, true]);
  const inputs = findAll(manager, (node) => node.tag === 'input');
  inputs[0].value = 'Written work revised';
  categorySelect.value = 'performanceTasks';
  categorySelect.events.change();
  assert.deepEqual(groups.map((group) => group.hidden), [true, false, true]);
  assert.match(groups[1].textContent, /No columns yet/);
  categorySelect.value = 'examination';
  categorySelect.events.change();
  assert.deepEqual(groups.map((group) => group.hidden), [true, true, false]);
  inputs[3].value = '50';
  categorySelect.value = 'writtenOral';
  categorySelect.events.change();
  assert.equal(inputs[0].value, 'Written work revised', 'Switching categories preserves unsaved edits');
  assert.equal(inputs[3].value, '50');
  await manager.onsubmit({ preventDefault() {} });
  assert.equal(saves, 2);
  assert.equal(data.activities[0].title, 'Written work revised');
  assert.equal(data.activities[1].maxScore, 50);
  assert.equal(findAll(root, (node) => node.tag === 'dialog')[0].open, false);
});

test('score inputs block values over maximum, save valid scores and reload them', async () => {
  const data = {
    gradeVersion: 0,
    activities: [{ _id: 'a', term: 1, category: 'writtenOral', title: 'WS 1', maxScore: 50 }],
    totalStudents: 1,
    roster: [{ studentId: 's1', firstName: 'Ana', lastName: 'Santos', activityScores: {} }]
  };
  let saves = 0;
  const { root, browser } = fixture(async (url, options) => {
    if (options) {
      assert.ok(url.endsWith('/activity-scores'));
      const input = JSON.parse(options.body);
      assert.equal(input.grades[0].scores.a, 50);
      saves++;
      data.roster[0].activityScores.a = 50;
      return { gradeVersion: 1 };
    }
    return data;
  });
  const open = async () => {
    await browser.show();
    findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
    await flush();
  };
  await open();
  let input = findAll(root, (node) => node.className === 'activity-score-input')[0];
  const save = byId(root, 'save-activity-scores');
  assert.equal(input.value, '');
  input.value = '51';
  input.events.input();
  assert.equal(save.disabled, true);
  assert.match(root.textContent, /Enter 0 to 50 points/);
  await save.events.click();
  assert.equal(saves, 0);
  input.value = '50';
  input.events.input();
  assert.equal(save.disabled, false);
  await save.events.click();
  assert.equal(saves, 1);
  await open();
  input = findAll(root, (node) => node.className === 'activity-score-input')[0];
  assert.equal(input.value, '50');
});

test('category totals and PS are read-only, term-specific and update with score drafts and activities', async () => {
  const activities = [50, 50, 100, 100].map((maxScore, index) => ({
    _id: 'w' + index, term: 1, category: 'writtenOral', title: 'Work ' + index, maxScore
  }));
  activities.push(
    { _id: 'p', term: 1, category: 'performanceTasks', title: 'Task', maxScore: 80 },
    { _id: 'other', term: 2, category: 'writtenOral', title: 'Other term', maxScore: 200 }
  );
  const data = {
    activities, totalStudents: 1, gradeVersion: 0,
    roster: [{ studentId: 's', firstName: 'Ana', lastName: 'Santos', activityScores: { w0: 25, w1: 25, w2: 50, w3: 50, p: 60 } }]
  };
  const { root, browser } = fixture(async (url, options) => {
    if (options?.method === 'POST') {
      data.activities.push({ ...JSON.parse(options.body), _id: 'new' });
      return { activities: data.activities, gradeVersion: 1 };
    }
    return data;
  });
  await browser.show();
  findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
  await flush();
  const maxima = () => findAll(root, (node) => node.className === 'activity-max activity-summary').map((node) => node.textContent);
  const summaries = () => findAll(root, (node) => node.className === 'activity-summary-value').map((node) => node.textContent);
  assert.deepEqual(maxima(), ['300', '100', '20%', '80', '100', '60%', '100', '20%']);
  assert.deepEqual(summaries(), ['150', '50', '10', '60', '75', '45']);
  assert.equal(findAll(root, (node) => node.className === 'activity-score-input').length, 5);
  const input = findAll(root, (node) => node.className === 'activity-score-input')[0];
  input.value = '50';
  input.events.input();
  assert.deepEqual(summaries().slice(0, 3), ['175', '58.33', '11.67']);
  input.value = '51';
  input.events.input();
  assert.deepEqual(summaries().slice(0, 3), ['—', '—', '—']);
  input.value = '0';
  input.events.input();
  assert.deepEqual(summaries().slice(0, 3), ['125', '41.67', '8.33']);
  input.value = '';
  input.events.input();
  assert.deepEqual(summaries().slice(0, 3), ['—', '—', '—']);
  findAll(root, (node) => node.tag === 'button' && node.textContent === '+ Add column')[0].events.click();
  const form = findAll(root, (node) => node.className === 'activity-editor')[0];
  const inputs = findAll(form, (node) => node.tag === 'input');
  inputs[0].value = 'Extra work';
  inputs[1].value = '50';
  await form.events.submit({ preventDefault() {} });
  assert.deepEqual(maxima(), ['350', '100', '20%', '80', '100', '60%', '100', '20%']);
  const select = byId(root, 'class-term-select');
  select.value = '2';
  select.events.change();
  assert.deepEqual(maxima(), ['200', '100', '20%', '0', '100', '60%', '100', '20%']);
  assert.deepEqual(summaries(), ['—', '—', '—', '—', '—', '—']);
});

test('exam weighted columns match the reference and percentage entry is examination-only', async () => {
  const data = { totalStudents: 1, gradeVersion: 0, activities: [
    { _id: 'st1', term: 1, category: 'examination', title: 'ST1', maxScore: 50, wsPercentage: 30 },
    { _id: 'st2', term: 1, category: 'examination', title: 'ST2', maxScore: 50, wsPercentage: 30 },
    { _id: 'te', term: 1, category: 'examination', title: 'TE', maxScore: 100, wsPercentage: 40 }
  ], roster: [{ studentId: 's', firstName: 'Ana', lastName: 'Santos', activityScores: { st1: 30, st2: 25, te: 70 } }] };
  let writes = 0;
  const { root, browser } = fixture(async (url, options) => {
    if (options) {
      const body = JSON.parse(options.body);
      if (options.method === 'POST') {
        assert.equal(body.wsPercentage, 25);
        data.activities.push({ ...body, _id: 'new' });
      } else {
        assert.equal(options.method, 'PUT');
        assert.equal(body.wsPercentage, 20);
        data.activities[0].wsPercentage = body.wsPercentage;
      }
      writes++;
      return { activities: data.activities, gradeVersion: writes };
    }
    return data;
  });
  async function open() {
    await browser.show();
    findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
    await flush();
  }
  await open();
  const results = () => findAll(root, (node) => node.className === 'examination-summary-value').map((node) => node.textContent);
  assert.deepEqual(results(), ['18', '15', '28', '61', '12.2']);
  const headers = findAll(root, (node) => node.className === 'activity-weighted-header');
  assert.deepEqual(headers.map((node) => node.textContent), ['WS ST1', 'WS ST2', 'WS TE']);
  const score = findAll(root, (node) => node.className === 'activity-score-input')[0];
  score.value = '0'; score.events.input();
  assert.deepEqual(results(), ['0', '15', '28', '43', '8.6']);
  score.value = ''; score.events.input();
  assert.deepEqual(results(), ['—', '15', '28', '—', '—']);
  score.value = '30'; score.events.input();
  await open();
  const add = findAll(root, (node) => node.tag === 'button' && node.textContent === '+ Add column');
  add[0].events.click();
  assert.equal(byId(root, 'activity-ws-percentage').disabled, true);
  add[2].events.click();
  const form = findAll(root, (node) => node.className === 'activity-editor')[0];
  const inputs = findAll(form, (node) => node.tag === 'input');
  assert.equal(inputs[2].disabled, false);
  assert.equal(inputs[2].parent.hidden, false);
  inputs[0].value = 'Test 4'; inputs[1].value = '50';
  for (const invalid of ['', '0', '-1', '101']) {
    inputs[2].value = invalid;
    await form.events.submit({ preventDefault() {} });
    assert.equal(writes, 0);
  }
  inputs[2].value = '25';
  await form.events.submit({ preventDefault() {} });
  await open();
  assert.match(root.textContent, /WS Test 4/);
  assert.deepEqual(results(), ['18', '15', '28', '—', '—', '—']);
  findAll(root, (node) => node.textContent === 'Manage columns')[0].events.click();
  const category = byId(root, 'activity-manager-category');
  category.value = 'examination'; category.events.change();
  const manager = findAll(root, (node) => node.className === 'activity-manager')[0];
  const weights = findAll(manager, (node) => node.tag === 'input');
  weights[2].value = '20'; weights[2].events.input();
  const undo = findAll(manager, (node) => node.className?.includes('activity-undo'))[0];
  assert.equal(undo.disabled, false);
  undo.events.click(); assert.equal(weights[2].value, '30');
  weights[2].value = '20'; weights[2].events.input();
  await manager.onsubmit({ preventDefault() {} });
  assert.equal(writes, 2);
  assert.equal(results()[0], '12');
});

test('legacy examinations explain missing weights and recalculate existing scores after setting them', async () => {
  const data = { totalStudents: 1, gradeVersion: 0, activities: [
    { _id: 'st1', term: 1, category: 'examination', title: 'ST1', maxScore: 50 },
    { _id: 'te', term: 1, category: 'examination', title: 'TE', maxScore: 100 }
  ], roster: [{ studentId: 's', firstName: 'Ana', lastName: 'Santos', activityScores: { st1: 26, te: 70 } }] };
  let writes = 0;
  const { root, browser } = fixture(async (url, options) => {
    if (options) {
      const body = JSON.parse(options.body);
      assert.equal(body.version, writes);
      const activity = data.activities.find((item) => url.endsWith('/' + item._id));
      activity.wsPercentage = body.wsPercentage;
      writes++;
      return { activities: data.activities, gradeVersion: writes };
    }
    return data;
  });
  await browser.show();
  findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
  await flush();
  assert.match(byId(root, 'examination-weight-notice').textContent, /ST1, TE/);
  findAll(root, (node) => node.tag === 'button' && node.textContent === 'Set examination percentages')[0].events.click();
  assert.equal(byId(root, 'activity-manager-category').value, 'examination');
  const manager = findAll(root, (node) => node.className === 'activity-manager')[0];
  await manager.onsubmit({ preventDefault() {} });
  assert.equal(writes, 0);
  assert.match(manager.textContent, /Enter a WS Percentage/);
  const inputs = findAll(manager, (node) => node.tag === 'input');
  inputs[2].value = '40'; inputs[5].value = '60';
  await manager.onsubmit({ preventDefault() {} });
  assert.equal(writes, 2);
  assert.equal(byId(root, 'examination-weight-notice'), undefined);
  assert.deepEqual(findAll(root, (node) => node.className === 'examination-summary-value').map((node) => node.textContent), ['20.8', '42', '62.8', '12.56']);
});

test('initial and transmuted term grades update live with colors and descriptors and survive reload', async () => {
  const data = { totalStudents: 1, gradeVersion: 0, activities: [
    { _id: 'w', term: 1, category: 'writtenOral', title: 'Work', maxScore: 100 },
    { _id: 'p', term: 1, category: 'performanceTasks', title: 'Task', maxScore: 100 },
    { _id: 'e', term: 1, category: 'examination', title: 'Exam', maxScore: 100, wsPercentage: 100 }
  ], roster: [{ studentId: 's', firstName: 'Ana', lastName: 'Santos', activityScores: { w: 70, p: 70, e: 70 } }] };
  const { root, browser } = fixture(async (url, options) => {
    if (options) {
      const payload = JSON.parse(options.body);
      Object.assign(data.roster[0].activityScores, payload.grades[0].scores);
      return { gradeVersion: 1 };
    }
    return data;
  });
  async function open() {
    await browser.show();
    findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
    await flush();
  }
  await open();
  const cells = () => byId(root, 'class-grades-tbody').children[0].children.slice(-3);
  assert.deepEqual(cells().map((cell) => cell.textContent), ['70.00', '75', 'Connecting']);
  assert.equal(cells()[1].children[0].className, 'term-grade-passed');
  const written = findAll(root, (node) => node.className === 'activity-score-input')[0];
  written.value = '69'; written.events.input();
  assert.deepEqual(cells().map((cell) => cell.textContent), ['69.80', '74', 'Developing']);
  assert.equal(cells()[1].children[0].className, 'term-grade-failed');
  written.value = ''; written.events.input();
  assert.deepEqual(cells().map((cell) => cell.textContent), ['—', '—', 'Not graded']);
  written.value = '69'; written.events.input();
  await byId(root, 'save-activity-scores').events.click();
  await open();
  assert.deepEqual(cells().map((cell) => cell.textContent), ['69.80', '74', 'Developing']);
});

test('custom order stays local until saved and survives reload without moving scores to another activity', async () => {
  const data = { totalStudents: 1, gradeVersion: 0, activities: [
    { _id: 'a', term: 1, category: 'writtenOral', title: 'Alpha', maxScore: 50 },
    { _id: 'b', term: 1, category: 'writtenOral', title: 'Beta', maxScore: 100 }
  ], roster: [{ studentId: 's', firstName: 'Ana', lastName: 'Santos', activityScores: { a: 20, b: 80 } }] };
  let writes = 0;
  const { root, browser } = fixture(async (url, options) => {
    if (options) {
      assert.ok(url.endsWith('/activity-order'));
      const body = JSON.parse(options.body);
      assert.equal(body.category, 'writtenOral');
      assert.equal(body.term, 1);
      assert.equal(body.version, 0);
      assert.deepEqual(body.activityIds, ['b', 'a']);
      data.activities = body.activityIds.map((id) => data.activities.find((item) => item._id === id));
      writes++;
      return { activities: data.activities, gradeVersion: 1 };
    }
    return data;
  });
  async function open() {
    await browser.show();
    findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
    await flush();
  }
  function manager() {
    findAll(root, (node) => node.textContent === 'Manage columns')[0].events.click();
    const category = byId(root, 'activity-manager-category');
    category.value = 'writtenOral'; category.events.change();
    return findAll(root, (node) => node.className === 'activity-manager')[0];
  }
  await open();
  let form = manager();
  const move = () => findAll(form, (node) => node.className?.includes('activity-drag-handle'))[1].events.keydown({ key: 'ArrowUp', preventDefault() {} });
  move();
  assert.equal(writes, 0);
  assert.equal(findAll(form, (node) => node.tag === 'input')[0].value, 'Beta');
  findAll(form, (node) => node.textContent === 'Cancel')[0].events.click();
  form = manager();
  assert.equal(findAll(form, (node) => node.tag === 'input')[0].value, 'Alpha');
  move();
  await form.onsubmit({ preventDefault() {} });
  assert.equal(writes, 1);
  await open();
  assert.deepEqual(findAll(root, (node) => node.className === 'activity-score-input').map((node) => node.value), ['80', '20']);
});

test('exam normalization updates PS, WS and grades for terms 1–3 including weights totaling 170', async () => {
  const data = { totalStudents: 1, gradeVersion: 0, activities: [],
    roster: [{ studentId: 's', firstName: 'Ana', lastName: 'Santos', activityScores: {} }] };
  for (const [term, weights] of [[1, [30,30,30,40,40]], [2, [20,20]], [3, [30,70]]]) {
    const items = [
      { category: 'writtenOral', title: 'Written' },
      { category: 'performanceTasks', title: 'Task' },
      ...weights.map((wsPercentage, index) => ({ category: 'examination', title: 'Exam ' + index, wsPercentage }))
    ];
    items.forEach((item, index) => {
      const id = term + '-' + index;
      data.activities.push({ ...item, _id: id, term, maxScore: 100 });
      data.roster[0].activityScores[id] = 100;
    });
  }
  const { root, browser } = fixture(async () => data);
  await browser.show();
  findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
  await flush();
  const select = byId(root, 'class-term-select');
  const exams = () => findAll(root, (node) => node.className === 'examination-summary-value').map((node) => node.textContent);
  for (const value of ['1', '2', '3']) {
    select.value = value; select.events.change();
    assert.deepEqual(exams().slice(-2), ['100', '20']);
    const cells = byId(root, 'class-grades-tbody').children[0].children.slice(-3);
    assert.deepEqual(cells.map((cell) => cell.textContent), ['100.00', '100', 'Advancing']);
  }
  select.value = '1'; select.events.change();
  const firstExam = findAll(root, (node) => node.className === 'activity-score-input')[2];
  firstExam.value = '0'; firstExam.events.input();
  assert.deepEqual(exams().slice(-2), ['82.35', '16.47']);
  assert.deepEqual(byId(root, 'class-grades-tbody').children[0].children.slice(-3).map((cell) => cell.textContent), ['96.47', '97', 'Advancing']);
});

test('Final Grades exposes finalization only for complete saved terms and locks after confirming', async () => {
  const data = { totalStudents: 1, gradeVersion: 2, canRequestEdit: true, gradeStatus: 'draft', activities: [],
    roster: [{ studentId: 's', firstName: 'Ana', lastName: 'Santos', activityScores: {} }] };
  for (const term of [1, 2, 3]) {
    for (const category of ['writtenOral', 'performanceTasks', 'examination']) {
      const id = term + category;
      data.activities.push({ _id: id, title: id, term, category, maxScore: 100, wsPercentage: 100 });
      data.roster[0].activityScores[id] = 100;
    }
  }
  let writes = 0;
  const { root, browser, context } = fixture(async (url, options) => {
    if (options) {
      assert.ok(url.endsWith('/finalize'));
      assert.equal(JSON.parse(options.body).version, 2);
      writes++;
      data.gradeStatus = 'finalized';
      return { message: 'Finalized' };
    }
    return data;
  });
  await browser.show();
  findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
  await flush();
  const button = byId(root, 'finalize-activity-grades');
  assert.equal(button.hidden, true);
  const select = byId(root, 'class-term-select');
  select.value = '4'; select.events.change();
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  context.window.confirm = () => false;
  await button.events.click();
  assert.equal(writes, 0);
  select.value = '1'; select.events.change();
  const input = findAll(root, (node) => node.className === 'activity-score-input')[0];
  input.value = '90'; input.events.input();
  select.value = '4'; select.events.change();
  assert.equal(button.disabled, true);
  select.value = '1'; select.events.change();
  const restored = findAll(root, (node) => node.className === 'activity-score-input')[0];
  restored.value = '100'; restored.events.input();
  select.value = '4'; select.events.change();
  context.window.confirm = () => true;
  await button.events.click();
  assert.equal(writes, 1);
  assert.equal(button.textContent, 'Grades finalized');
  assert.equal(button.disabled, true);
});

test('activity creation requires both a nonblank name and maximum points', async () => {
  let writes = 0;
  const { root, browser } = fixture(async (url, options) => {
    if (options) {
      writes++;
      return { activities: [], gradeVersion: 1 };
    }
    return { totalStudents: 0, activities: [], roster: [] };
  });
  await browser.show();
  findAll(root, (node) => node.tag === 'a')[0].events.click({ preventDefault() {} });
  await flush();
  findAll(
    root,
    (node) => node.textContent === '+ Add column' && node.tag === 'button'
  )[0].events.click();
  const form = findAll(root, (node) => node.className === 'activity-editor')[0];
  const inputs = findAll(form, (node) => node.tag === 'input');
  for (const [name, max] of [
    ['', '50'],
    ['   ', '50'],
    ['WS 1', ''],
    ['WS 1', '0']
  ]) {
    inputs[0].value = name;
    inputs[1].value = max;
    await form.events.submit({ preventDefault() {} });
    assert.equal(writes, 0);
  }
  inputs[0].value = 'WS 1';
  inputs[1].value = '50';
  await form.events.submit({ preventDefault() {} });
  assert.equal(writes, 1);
});
