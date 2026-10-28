const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Audit = require('../models/AcademicAudit');
const Grade = require('../models/Grade');
const { addActivity } = require('../services/academic');

test('activity creation saves term-specific columns and enforces ownership, locks, versions and limits', async (t) => {
  const actor = { role: 'teacher', userId: 'teacher1' };
  const id = '123456789012345678901234';
  const subject = new Subject({ _id: id, name: 'Science', class: id });
  // Keep ownership checks independent of ObjectId casting in this service test.
  const record = {
    teacher: actor.userId,
    _id: id,
    gradeStatus: 'draft',
    gradeVersion: 0,
    activities: subject.activities,
    save: async () => {}
  };
  let audits = 0;
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(null));
  t.mock.method(User, 'findOne', () => ({ session: async () => ({}) }));
  t.mock.method(Subject, 'findById', () => ({ session: async () => record }));
  t.mock.method(Audit, 'create', async ([entry]) => {
    assert.equal(entry.action, 'activity-added');
    audits++;
  });
  const input = {
    term: 1,
    category: 'writtenOral',
    title: 'Written Work 1',
    maxScore: 5,
    version: 0
  };
  const result = await addActivity(actor, id, input);
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].maxScore, 5);
  assert.equal(result.activities[0].term, 1);
  assert.ok(result.activities[0]._id);
  assert.equal(result.gradeVersion, 1);
  await assert.rejects(addActivity(actor, id, input), { status: 409 });
  for (const invalid of [
    { term: 4 },
    { category: 'other' },
    { title: '' },
    { maxScore: 0 },
    { maxScore: 2.5 }
  ]) {
    await assert.rejects(addActivity(actor, id, { ...input, version: 1, ...invalid }), {
      status: 400
    });
  }
  record.gradeStatus = 'finalized';
  await assert.rejects(addActivity(actor, id, { ...input, version: 1 }), { status: 409 });
  record.gradeStatus = 'draft';
  record.teacher = 'other';
  await assert.rejects(addActivity(actor, id, { ...input, version: 1 }), { status: 403 });
  assert.equal(audits, 1);
  assert.equal(record.activities.length, 1);
});

test('activity editing and deletion persist with version and ownership checks', async (t) => {
  const { changeActivity } = require('../services/academic');
  const actor = { role: 'teacher', userId: 'teacher1' },
    id = '123456789012345678901234';
  const subject = new Subject({
    name: 'Science',
    class: id,
    activities: [{ term: 1, category: 'writtenOral', title: 'Work 1', maxScore: 5 }]
  });
  const activityId = String(subject.activities[0]._id);
  const record = {
    _id: id,
    teacher: actor.userId,
    activities: subject.activities,
    gradeStatus: 'draft',
    gradeVersion: 0,
    save: async () => {}
  };
  const actions = [];
  t.mock.method(Grade, 'updateMany', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(null));
  t.mock.method(User, 'findOne', () => ({ session: async () => ({}) }));
  t.mock.method(Subject, 'findById', () => ({ session: async () => record }));
  t.mock.method(Audit, 'create', async ([entry]) => actions.push(entry.action));
  await changeActivity(actor, id, activityId, { version: 0, title: 'Revised work', maxScore: 50 });
  assert.equal(record.activities[0].title, 'Revised work');
  assert.equal(record.activities[0].maxScore, 50);
  assert.equal(String(record.activities[0]._id), activityId);
  await assert.rejects(changeActivity(actor, id, activityId, { version: 0 }, true), {
    status: 409
  });
  record.gradeStatus = 'finalized';
  await assert.rejects(changeActivity(actor, id, activityId, { version: 1 }, true), {
    status: 409
  });
  record.gradeStatus = 'draft';
  record.teacher = 'other';
  await assert.rejects(changeActivity(actor, id, activityId, { version: 1 }, true), {
    status: 403
  });
  record.teacher = actor.userId;
  await assert.rejects(
    changeActivity(actor, id, activityId, { version: 1, title: 'Bad', maxScore: 0 }),
    { status: 400 }
  );
  const result = await changeActivity(actor, id, activityId, { version: 1 }, true);
  assert.equal(result.activities.length, 0);
  assert.equal(result.gradeVersion, 2);
  assert.deepEqual(actions, ['activity-updated', 'activity-deleted']);
});

test('exam percentages validate and persist on creation and edits', async (t) => {
  const { changeActivity } = require('../services/academic');
  const actor = { role: 'teacher', userId: 'teacher1' }, id = '123456789012345678901234';
  const subject = new Subject({ name: 'Science', class: id });
  const record = { _id: id, teacher: actor.userId, activities: subject.activities, gradeStatus: 'draft', gradeVersion: 0, save: async () => {} };
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(null));
  t.mock.method(User, 'findOne', () => ({ session: async () => ({}) }));
  t.mock.method(Subject, 'findById', () => ({ session: async () => record }));
  t.mock.method(Audit, 'create', async () => {});
  const input = { term: 1, category: 'examination', title: 'ST1', maxScore: 50, version: 0 };
  for (const wsPercentage of [undefined, null, '', '30', 0, -1, 101, NaN, Infinity])
    await assert.rejects(addActivity(actor, id, { ...input, wsPercentage }), { status: 400 });
  await addActivity(actor, id, { ...input, wsPercentage: 30 });
  assert.equal(record.activities[0].toObject().wsPercentage, 30);
  const activityId = String(record.activities[0]._id);
  await changeActivity(actor, id, activityId, { title: 'ST1', maxScore: 50, version: 1, wsPercentage: 25.5 });
  assert.equal(record.activities[0].wsPercentage, 25.5);
  await assert.rejects(changeActivity(actor, id, activityId, { title: 'ST1', maxScore: 50, version: 2, wsPercentage: 101 }), { status: 400 });
});

test('activity scores reject maximum bypasses and isolate enrolled students and terms', () => {
  const P = require('../services/academic-policy');
  const studentId = '111111111111111111111111',
    activityId = '222222222222222222222222';
  const activities = [{ _id: activityId, term: 1, title: 'WS 1', maxScore: 50 }];
  const validate = (score) =>
    P.validateActivityScores(
      [{ studentId, scores: { [activityId]: score } }],
      [studentId],
      activities,
      1
    );
  for (const score of [0, 49.5, 50, null])
    assert.equal(validate(score)[0].scores[activityId], score);
  for (const score of [51, -1, '50', '', NaN, Infinity, undefined])
    assert.throws(() => validate(score), { status: 400 });
  assert.throws(
    () =>
      P.validateActivityScores([{ studentId, scores: { [activityId]: 50 } }], [], activities, 1),
    { status: 403 }
  );
  assert.throws(
    () =>
      P.validateActivityScores(
        [{ studentId, scores: { [activityId]: 50 } }],
        [studentId],
        activities,
        2
      ),
    { status: 409 }
  );
});

test('saving scores validates before writing, uses versions, and preserves unrelated activity scores', async (t) => {
  const { saveActivityScores } = require('../services/academic');
  const Student = require('../models/Student');
  const actor = { role: 'teacher', userId: 'teacher1' },
    id = '123456789012345678901234';
  const studentId = '111111111111111111111111',
    activityId = '222222222222222222222222';
  const record = {
    _id: id,
    teacher: actor.userId,
    gradeStatus: 'draft',
    gradeVersion: 0,
    activities: [{ _id: activityId, term: 1, title: 'WS 1', maxScore: 50 }],
    save: async () => {}
  };
  let written = null;
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(null));
  t.mock.method(User, 'findOne', () => ({ session: async () => ({}) }));
  t.mock.method(Subject, 'findById', () => ({ session: async () => record }));
  t.mock.method(Student, 'find', () => ({
    select: () => ({ session: async () => [{ _id: studentId }] })
  }));
  t.mock.method(Grade, 'find', () => ({ lean: () => ({ session: async () => [] }) }));
  t.mock.method(Grade, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.student, studentId);
    written = update;
  });
  t.mock.method(Audit, 'create', async () => {});
  const input = (score) => ({
    version: 0,
    term: 1,
    grades: [{ studentId, scores: { [activityId]: score } }]
  });
  await assert.rejects(saveActivityScores(actor, id, input(51)), { status: 400 });
  assert.equal(written, null);
  assert.equal((await saveActivityScores(actor, id, input(50))).gradeVersion, 1);
  assert.deepEqual(written, {
    $set: { updatedBy: actor.userId, ['activityScores.' + activityId]: 50 }
  });
  await assert.rejects(saveActivityScores(actor, id, input(30)), { status: 409 });
  record.gradeStatus = 'finalized';
  await assert.rejects(saveActivityScores(actor, id, { ...input(30), version: 1 }), {
    status: 409
  });
});

test('maximum points cannot be reduced below stored scores', async (t) => {
  const { changeActivity } = require('../services/academic');
  const actor = { role: 'teacher', userId: 'teacher1' },
    id = '123456789012345678901234';
  const subject = new Subject({
    name: 'Science',
    class: id,
    activities: [{ term: 1, category: 'writtenOral', title: 'WS 1', maxScore: 50 }]
  });
  const activityId = String(subject.activities[0]._id);
  const record = {
    _id: id,
    teacher: actor.userId,
    activities: subject.activities,
    gradeStatus: 'draft',
    gradeVersion: 0
  };
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(null));
  t.mock.method(User, 'findOne', () => ({ session: async () => ({}) }));
  t.mock.method(Subject, 'findById', () => ({ session: async () => record }));
  t.mock.method(Grade, 'exists', (filter) => {
    assert.deepEqual(filter, { subject: id, ['activityScores.' + activityId]: { $gt: 40 } });
    return { session: async () => ({ _id: 'grade' }) };
  });
  await assert.rejects(
    changeActivity(actor, id, activityId, { version: 0, title: 'WS 1', maxScore: 40 }),
    { status: 409 }
  );
  assert.equal(record.activities[0].maxScore, 50);
});
