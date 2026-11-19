const { test } = require('node:test');
const assert = require('node:assert/strict');
const SF9 = require('../services/sf9');
const catalog = require('../../Frontend/js/core-values');
function fixture() {
  const student = { _id: 'student' }, subject = { _id: 'math', name: 'Math' };
  const data = { attendance: [], narratives: [], values: [] };
  for (let term = 1; term <= 3; term++) {
    data.attendance.push({ student: 'student', subject: 'math', term, date: '2026-01-0' + term, status: 'present' });
    data.narratives.push({ student: 'student', subject: 'math', term, canDo: 'Can calculate', improving: 'Explaining reasoning' });
    for (const category of ['filipino', 'personal']) data.values.push({ student: 'student', subject: 'math', term, category, ratings: new Map(catalog[category].items.map(([key]) => [key, 'AO'])) });
  }
  return { student, subject, data };
}
test('SF9 requires attendance, both values categories and both narrative fields in every term', () => {
  const { student, subject, data } = fixture();
  let result = SF9.build(student, [subject], data);
  assert.deepEqual(result.missing, []);
  assert.equal(result.monthlyAttendance[0].months.length, 11);
  assert.equal(result.values.length, 6);
  data.narratives[1].improving = ' ';
  data.values[0].ratings.set('faith', '');
  data.attendance[2].status = 'unmarked';
  result = SF9.build(student, [subject], data);
  assert.ok(result.missing.some((text) => text.includes('term 2: narrative')));
  assert.ok(result.missing.some((text) => text.includes('term 1: Filipino')));
  assert.ok(result.missing.some((text) => text.includes(': attendance')));
});
test('SF9 detects missing attendance sessions and legacy records without a term', () => {
  const { student, subject, data } = fixture();
  data.attendance.push({ student: 'other', subject: 'math', term: 1, date: '2026-02-01', status: 'present' });
  assert.ok(SF9.build(student, [subject], data).missing.some((text) => text.includes(': attendance')));
  data.attendance.pop();
  data.attendance[1].term = undefined;
  assert.equal(SF9.build(student, [subject], data).missing.some((text) => text.includes(': attendance')), false);
});


test('monthly attendance isolates subjects and counts each date once within a subject', () => {
  const student = { _id: 'student' };
  const subjects = Array.from({ length: 8 }, (_, i) => ({ _id: 's' + i, name: 'Subject ' + i }));
  const attendance = subjects.flatMap((subject) => [1, 2, 3].map((term) => ({ student: 'student', subject: subject._id, term, date: '2026-06-01', status: subject._id === 's0' ? 'tardy' : 'absent' })));
  attendance.push({ student: 'student', subject: 's0', term: 1, date: '2026-06-02', status: 'absent' });
  attendance.push({ student: 'student', subject: 's0', term: 2, date: '2027-01-01', status: 'present' });
  attendance.push({ student: 'student', subject: 'unrelated', term: 1, date: '2026-06-03', status: 'present' });
  const result = SF9.build(student, subjects, { attendance, narratives: [], values: [] });
  assert.equal(result.monthlyAttendance.length, 8);
  const first = result.monthlyAttendance.find((item) => item.subjectId === 's0').months;
  const second = result.monthlyAttendance.find((item) => item.subjectId === 's1').months;
  assert.equal(first.length, 11);
  assert.deepEqual(first[0], { label: 'Jun', key: '2026-06', schoolDays: 2, present: 1, absent: 1, tardy: 1 });
  assert.deepEqual(second[0], { label: 'Jun', key: '2026-06', schoolDays: 1, present: 0, absent: 1, tardy: 0 });
  assert.equal(first.find((month) => month.key === '2027-01').present, 1);
  assert.equal(second.find((month) => month.key === '2027-01').present, 0);
});
