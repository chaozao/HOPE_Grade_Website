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
  t.mock.method(Attendance, 'updateOne', async (filter, update) => {
    records.set(filter.date, { ...filter, ...update.$set });
  });
  t.mock.method(Attendance, 'find', async (filter) => records.has(filter.date) ? [records.get(filter.date)] : []);
  assert.equal((await service.attendance(actor, id, '2026-11-06')).roster[0].status, 'unmarked');
  for (const status of ['absent', 'present', 'tardy', 'unmarked']) {
    await service.saveAttendance(actor, id, studentId, { date: '2026-11-06', status });
    assert.equal((await service.attendance(actor, id, '2026-11-06')).roster[0].status, status);
    assert.equal((await service.attendance(actor, id, '2026-11-05')).roster[0].status, 'unmarked');
  }
  await assert.rejects(service.attendance(actor, id, '2026-02-30'), { status: 400 });
  await assert.rejects(service.saveAttendance(actor, id, studentId, { date: '2026-11-06', status: 'invalid' }), { status: 400 });
  student.subjects = [];
  await assert.rejects(service.saveAttendance(actor, id, studentId, { date: '2026-11-06', status: 'present' }), { status: 403 });
  subject.teacher = 'other';
  await assert.rejects(service.attendance(actor, id, '2026-11-06'), { status: 403 });
  await assert.rejects(service.saveAttendance(actor, id, studentId, { date: '2026-11-06', status: 'present' }), { status: 403 });
});
