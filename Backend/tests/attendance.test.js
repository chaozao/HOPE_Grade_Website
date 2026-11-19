const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const service = require('../services/academic');

test('assigned subjects include student grade levels when the class grade level is blank', async (t) => {
  const actor = { role: 'teacher', userId: '333333333333333333333333' };
  t.mock.method(User, 'findOne', () => ({ session: async () => ({}) }));
  t.mock.method(Subject, 'find', (filter) => {
    assert.equal(filter.teacher, actor.userId);
    return { populate: async () => [{ _id: 'subject1', name: 'Physics', class: { _id: 'class1', name: 'Science', section: 'Emerald', gradeLevel: '' } }] };
  });
  t.mock.method(Student, 'countDocuments', async () => 2);
  t.mock.method(Student, 'distinct', async (field, filter) => {
    assert.equal(field, 'gradeLevel');
    assert.equal(filter.$or[0].subjects, 'subject1');
    return ['Grade 7', '', null, 'Grade 7'];
  });
  const subjects = await service.mySubjects(actor);
  assert.deepEqual(subjects[0].gradeLevels, ['Grade 7']);
  assert.equal(subjects[0].classId, 'class1');
  assert.equal(subjects[0].studentCount, 2);
});

test('attendance is date-specific, persists statuses and rejects unauthorized or invalid changes', async (t) => {
  const id = '111111111111111111111111', studentId = '222222222222222222222222';
  const actor = { role: 'teacher', userId: '333333333333333333333333' };
  const subject = { _id: id, teacher: actor.userId };
  const student = { _id: studentId, subjects: [id], lastName: 'Alba', firstName: 'Ben' };
  const records = new Map();
  const query = (value) => ({ session: async () => value, sort: async () => value });
  t.mock.method(User, 'findOne', () => query({}));
  t.mock.method(Subject, 'findById', () => query(subject));
  t.mock.method(Student, 'findById', async () => student);
  t.mock.method(Student, 'find', () => query([student]));
  t.mock.method(Attendance, 'ensureTermIndex', async () => {});
  t.mock.method(Attendance, 'updateOne', async (filter, update) => {
    records.set(filter.date + ':' + filter.term, { ...filter, ...update.$set });
  });
  t.mock.method(Attendance, 'find', async (filter) => [...records.values()].filter((record) => record.date === filter.date));
  assert.equal((await service.attendance(actor, id, '2026-11-06', 1)).roster[0].status, 'unmarked');
  for (const status of ['absent', 'present', 'tardy', 'unmarked']) {
    await service.saveAttendance(actor, id, studentId, { term: 1, date: '2026-11-06', status });
    assert.equal((await service.attendance(actor, id, '2026-11-06', 1)).roster[0].status, status);
    assert.equal((await service.attendance(actor, id, '2026-11-05', 1)).roster[0].status, 'unmarked');
  }
  await assert.rejects(service.attendance(actor, id, '2026-02-30', 1), { status: 400 });
  await assert.rejects(service.saveAttendance(actor, id, studentId, { term: 1, date: '2026-11-06', status: 'invalid' }), { status: 400 });
  await service.saveAttendance(actor, id, studentId, { date: '2026-11-06', status: 'absent' });
  assert.equal((await service.attendance(actor, id, '2026-11-06')).roster[0].status, 'absent');
  await service.saveAttendance(actor, id, studentId, { date: '2026-11-07', status: 'present' });
  assert.equal((await service.attendance(actor, id, '2026-11-06')).roster[0].status, 'absent');
  assert.equal((await service.attendance(actor, id, '2026-11-07')).roster[0].status, 'present');
  student.subjects = [];
  await assert.rejects(service.saveAttendance(actor, id, studentId, { term: 1, date: '2026-11-06', status: 'present' }), { status: 403 });
  subject.teacher = 'other';
  await assert.rejects(service.attendance(actor, id, '2026-11-06', 1), { status: 403 });
  await assert.rejects(service.saveAttendance(actor, id, studentId, { term: 1, date: '2026-11-06', status: 'present' }), { status: 403 });
});


test('term index migration preserves records and unrelated indexes', async (t) => {
  const calls = [];
  t.mock.method(Attendance.collection, 'createIndex', async (key, options) => {
    assert.deepEqual(key, { subject: 1, student: 1, date: 1, term: 1 });
    assert.equal(options.unique, true);
    calls.push('create');
  });
  t.mock.method(Attendance.collection, 'indexes', async () => [
    { name: '_id_', key: { _id: 1 }, unique: true },
    { name: 'old_date_index', key: { subject: 1, student: 1, date: 1 }, unique: true },
    { name: 'new_term_index', key: { subject: 1, student: 1, date: 1, term: 1 }, unique: true }
  ]);
  t.mock.method(Attendance.collection, 'dropIndex', async (name) => { calls.push(name); });
  await Attendance.ensureTermIndex();
  await Attendance.ensureTermIndex();
  assert.deepEqual(calls, ['create', 'old_date_index']);
});


test('legacy term records resolve to the latest mark; date-only save takes priority without deleting history', () => {
  const daily = require('../services/daily-attendance');
  const base = { subject: 'physics', student: 'student', date: '2026-11-12' };
  const records = [{ ...base, term: 1, status: 'absent', updatedAt: '2026-11-12T08:00:00Z' },
    { ...base, term: 2, status: 'tardy', updatedAt: '2026-11-12T09:00:00Z' }];
  assert.equal(daily(records)[0].status, 'tardy');
  records.push({ ...base, term: null, status: 'present', updatedAt: '2026-11-12T10:00:00Z' });
  assert.equal(daily(records).length, 1);
  assert.equal(daily(records)[0].status, 'present');
  assert.equal(records.length, 3);
});
