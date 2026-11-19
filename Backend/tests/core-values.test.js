const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const Report = require('../models/CoreValueReport');
const service = require('../services/academic');
test('core values save separately by term and category and enforce assignment and valid ratings', async (t) => {
  const id = '1'.repeat(24), studentId = '2'.repeat(24);
  const actor = { role: 'teacher', userId: '3'.repeat(24) };
  const subject = { _id: id, class: 'class1', teacher: 'another-teacher' };
  const cls = { adviser: actor.userId };
  const student = { class: 'class1', _id: studentId, subjects: [id], firstName: 'Ben', lastName: 'Alba' };
  const records = new Map();
  t.mock.method(Class, 'findById', () => ({ session: async () => cls }));
  t.mock.method(User, 'findOne', () => ({ session: async () => ({}) }));
  t.mock.method(Subject, 'findById', () => ({ session: async () => subject }));
  t.mock.method(Student, 'findById', async () => student);
  t.mock.method(Student, 'find', () => ({ sort: async () => [student] }));
  t.mock.method(Report, 'find', async () => [...records.values()]);
  t.mock.method(Report, 'updateOne', async (filter, update) => records.set(filter.category + filter.term, { ...filter, ...update.$set }));
  const body = { term: 1, category: 'filipino', ratings: { faith: 'AO', truth: 'SO' } };
  await service.saveCoreValues(actor, id, studentId, body);
  await service.saveCoreValues(actor, id, studentId, { term: 2, category: 'personal', ratings: { unity: 'RO' } });
  const reports = (await service.coreValueReports(actor, id)).roster[0].reports;
  assert.equal(reports.length, 2);
  assert.equal(reports[0].ratings.faith, 'AO');
  assert.equal(reports[1].ratings.unity, 'RO');
  await assert.rejects(service.saveCoreValues(actor, id, studentId, { ...body, ratings: { unity: 'AO' } }), { status: 400 });
  await assert.rejects(service.saveCoreValues(actor, id, studentId, { ...body, ratings: { faith: 42 } }), { status: 400 });
  await assert.rejects(service.saveCoreValues(actor, id, studentId, { ...body, term: 4 }), { status: 400 });
  await assert.rejects(service.saveCoreValues(actor, id, studentId, { ...body, ratings: { faith: 'a'.repeat(10001) } }), { status: 400 });
  student.class = 'different-class';
  await assert.rejects(service.saveCoreValues(actor, id, studentId, body), { status: 403 });
  student.class = 'class1';
  student.subjects = [];
  await assert.rejects(service.saveCoreValues(actor, id, studentId, body), { status: 403 });
  cls.adviser = 'other';
  await assert.rejects(service.coreValueReports(actor, id), { status: 403 });
});


test("adviser report options include only subjects in the adviser's own classes", async (t) => {
  const actor = { role: 'teacher', userId: '3'.repeat(24) };
  t.mock.method(User, 'findOne', () => ({ session: async () => ({}) }));
  t.mock.method(Class, 'find', (filter) => {
    assert.equal(filter.adviser, actor.userId);
    return { session: async () => [{ _id: 'advisory' }] };
  });
  t.mock.method(Subject, 'find', (filter) => {
    assert.deepEqual(filter, { class: { $in: ['advisory'] } });
    return { populate: async () => [{ _id: 'math', name: 'Math', teacher: 'another-teacher', class: { _id: 'advisory', name: 'Advisory', gradeLevel: 'Grade 7' } }] };
  });
  t.mock.method(Student, 'countDocuments', async () => 1);
  t.mock.method(Student, 'distinct', async () => ['Grade 7']);
  const options = await service.advisoryReportSubjects(actor);
  assert.equal(options[0]._id, 'math');
  assert.equal(options[0].classId, 'advisory');
});
