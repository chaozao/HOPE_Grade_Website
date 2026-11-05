const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const Grade = require('../models/Grade');
const EditRequest = require('../models/GradeEditRequest');
const Audit = require('../models/AcademicAudit');
const service = require('../services/academic');

test('activity grades flow through completeness, finalization and final reports', async (t) => {
  const id = '123456789012345678901234', studentId = '111111111111111111111111';
  const actor = { role: 'teacher', userId: 'teacher1' };
  const cls = { _id: id, name: 'Science Class', adviser: actor.userId };
  const subject = { _id: id, class: id, name: 'Physics II', teacher: actor.userId,
    activities: [], gradeStatus: 'draft', gradeVersion: 0, save: async () => {} };
  const scores = new Map();
  for (const term of [1, 2, 3]) {
    for (const category of ['writtenOral', 'performanceTasks', 'examination']) {
      const key = term + category;
      subject.activities.push({ _id: key, term, category, maxScore: 100, wsPercentage: 100 });
      scores.set(key, 100);
    }
  }
  const student = { _id: studentId, class: id, subjects: [id], firstName: 'Juana', lastName: 'Dela Cruz' };
  const grade = { subject: id, student: studentId, scores: {}, activityScores: scores };
  function query(value) {
    const q = { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
    for (const method of ['session', 'lean', 'populate', 'select', 'sort']) q[method] = () => q;
    return q;
  }
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(null));
  t.mock.method(User, 'findOne', () => query({}));
  t.mock.method(User, 'findById', () => query({ username: 'Adviser' }));
  t.mock.method(Class, 'find', () => query([cls]));
  t.mock.method(Class, 'findById', () => query(cls));
  t.mock.method(Subject, 'find', () => query([subject]));
  t.mock.method(Subject, 'findById', () => query(subject));
  t.mock.method(Student, 'find', () => query([student]));
  t.mock.method(Student, 'findOne', () => query(student));
  t.mock.method(Grade, 'find', () => query([grade]));
  t.mock.method(EditRequest, 'countDocuments', async () => 0);
  t.mock.method(Audit, 'create', async () => {});
  let monitor = await service.monitor(actor);
  assert.equal(monitor.students[0].subjects[0].grade, 100);
  assert.equal(monitor.subjects[0].complete, 1);
  assert.equal(monitor.students[0].readyForReport, false);
  await assert.rejects(service.finalReport(actor, studentId), { status: 409 });
  scores.delete('3examination');
  assert.equal((await service.monitor(actor)).students[0].subjects[0].grade, null);
  await assert.rejects(service.finalize(actor, id, { version: 0 }), { status: 409 });
  scores.set('3examination', 100);
  await service.finalize(actor, id, { version: 0 });
  assert.equal(subject.gradeStatus, 'finalized');
  monitor = await service.monitor(actor);
  assert.equal(monitor.students[0].readyForReport, true);
  const report = await service.finalReport(actor, studentId);
  assert.equal(report.subjects[0].grade, 100);
  assert.equal(report.generalAverage, 100);
});
