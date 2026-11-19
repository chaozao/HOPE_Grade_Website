const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('SF9 modal contains all report sections and downloads/prints the complete report', async () => {
  const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.text = ''; this.events = {}; }
    set textContent(text) { this.text = text; this.children = []; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    replaceChildren(...children) { this.children = children; this.text = ''; }
    setAttribute() {}
    addEventListener(name, fn) { this.events[name] = fn; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    click() { this.clicked = true; this.events.click?.(); }
    remove() {}
    get firstElementChild() { return this.children[0]; }
    get outerHTML() { return '<' + this.tag + '>' + escape(this.text) + this.children.map((child) => child.outerHTML).join('') + '</' + this.tag + '>'; }
  }
  const body = new Element('body');
  const all = (root) => [root, ...root.children.flatMap(all)];
  let downloaded, printed = 0;
  const context = { window: { print() { printed++; } }, Node: Element, Blob,
    URL: { createObjectURL(file) { downloaded = file; return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout: (fn) => fn(),
    document: { body, createElement: (tag) => new Element(tag), getElementById: (id) => all(body).find((el) => el.id === id) } };
  vm.createContext(context);
  for (const name of ['academic-ui.js', 'core-values.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', name), 'utf8'), context);
  context.AcademicUI = context.window.AcademicUI;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/sf9-report.js'), 'utf8'), context);
  const data = { student: { lastName: 'Alba', firstName: 'Ben', lrn: '123' }, gradeLevel: 'Grade 7', section: 'Emerald', adviserName: 'Iris',
    attendance: [1,2,3].map((term) => ({ subject: 'Math', term, recorded: 10, present: 8, absent: 1, tardy: 1 })),
    monthlyAttendance: [{ subjectId: 'math', months: [{ label: 'Jun', schoolDays: 2, present: 1, absent: 1, tardy: 0 }] }],
    subjects: [{ subjectId: 'math', name: 'Math', terms: [90,91,92], grade: 91 }], generalAverage: 91,
    values: [], narratives: [{ subjectId: 'math', subject: 'Math', term: 1, canDo: '<script>text</script>', improving: 'Writing' }], generatedAt: new Date().toISOString() };
  context.window.SF9Report.show(data);
  const dialog = all(body).find((el) => el.id === 'report-dialog');
  assert.equal(dialog.open, true);
  for (const text of ['Alba, Ben', 'LRN: 123', 'Class Adviser: Iris', 'Summary of Attendance', 'Summary of Grades', 'Filipino Core Values', 'His/Her Core Values', 'Narrative Report', 'Passed']) assert.ok(dialog.textContent.includes(text), text);
  const narrative = all(dialog).find((el) => el.className === 'sf9-narrative');
  assert.equal(all(narrative).filter((el) => el.tag === 'tbody')[0].children.length, 3);
  const attendance = all(dialog).find((el) => el.className === 'sf9-attendance');
  assert.equal(all(attendance).filter((el) => el.tag === 'tbody')[0].children.length, 4);
  assert.ok(attendance.textContent.includes('No. of School Days'));
  all(dialog).find((el) => el.tag === 'button' && el.textContent === 'Save').click();
  const html = await downloaded.text();
  assert.match(html, /Summary of Attendance/);
  assert.match(html, /size:8.5in 13in/);
  assert.match(html, /break-before:page/);
  assert.match(html, /&lt;script&gt;text&lt;\/script&gt;/);
  assert.ok(!html.includes('<script>text</script>'));
  assert.ok(all(body).some((el) => el.download === 'SF9-123.html' && el.clicked));
  all(dialog).find((el) => el.tag === 'button' && el.textContent === 'Print').click();
  assert.equal(printed, 1);
  // Eight subjects still produce exactly three narrative rows, preserving every comment.
  data.subjects = Array.from({ length: 8 }, (_, index) => ({ subjectId: 's' + index, name: 'Subject ' + index, terms: [90, 90, 90], grade: 90 }));
  data.narratives = data.subjects.flatMap((subject) => [1, 2, 3].map((term) => ({ subjectId: subject.subjectId, subject: subject.name, term, canDo: subject.name + ' skill ' + term, improving: subject.name + ' improvement ' + term })));
  context.window.SF9Report.show(data);
  const expanded = all(dialog).filter((el) => el.className === 'sf9-narrative');
  assert.equal(expanded.length, 8);
  expanded.forEach((section, index) => {
    assert.equal(all(section).find((el) => el.tag === 'tbody').children.length, 3);
    for (const term of [1, 2, 3]) assert.ok(section.textContent.includes('Subject ' + index + ' skill ' + term));
    assert.ok(!section.textContent.includes('Subject ' + ((index + 1) % 8) + ' skill'));
  });
  all(dialog).find((el) => el.tag === 'button' && el.textContent === 'Close').click();
  assert.equal(dialog.open, false);
});
