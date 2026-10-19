const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const models = Object.fromEntries(
  ['User', 'Class', 'Subject', 'Student', 'Grade', 'GradeEditRequest', 'AcademicAudit'].map(
    (name) => [name, require('../models/' + name)]
  )
);
const { clearData } = require('../services/clear-data');
const id = (value) => String(value).padStart(24, '0');
const actor = { userId: id(1), role: 'admin' };
const body = (ids) => ({ ids, confirmation: 'CLEAR' });

test('clear data validates permission and confirmation before starting any deletion', async () => {
  await assert.rejects(clearData({ ...actor, role: 'teacher' }, 'classes', body([id(2)])), {
    status: 403
  });
  await assert.rejects(clearData(actor, 'teachers', body([id(2)])), { status: 400 });
  await assert.rejects(clearData(actor, 'classes', { ids: [id(2)] }), { status: 400 });
  await assert.rejects(clearData(actor, 'classes', body([])), { status: 400 });
  await assert.rejects(clearData(actor, 'subjects', body(['invalid'])), { status: 400 });
});

test('subject and class clearing preserve unrelated data and synchronize assignments', async (t) => {
  let state = {
    User: [
      { _id: id(1), role: 'admin', isActive: true },
      { _id: id(2), role: 'teacher' }
    ],
    Class: [{ _id: id(3), adviser: id(2) }, { _id: id(4) }],
    Subject: [
      { _id: id(5), class: id(3), teacher: id(2) },
      { _id: id(6), class: id(4) }
    ],
    Student: [
      { _id: id(7), class: id(3), subjects: [id(5)] },
      { _id: id(8), class: id(4), subjects: [id(6)] }
    ],
    Grade: [
      { _id: id(9), subject: id(5), student: id(7) },
      { _id: id(10), subject: id(6), student: id(8) }
    ],
    GradeEditRequest: [{ _id: id(11), class: id(3), subject: id(5) }],
    AcademicAudit: [{ subject: id(5) }, { student: id(7) }, { subject: id(6) }]
  };
  const matches = (doc, filter) =>
    Object.entries(filter).every(([key, value]) => {
      if (key === '$or') return value.some((part) => matches(doc, part));
      if (value?.$in)
        return (Array.isArray(doc[key]) ? doc[key] : [doc[key]]).some((item) =>
          value.$in.includes(item)
        );
      return doc[key] === value;
    });
  const session = {};
  const query = (value) => ({
    session: async () => value,
    select() {
      return this;
    }
  });
  for (const [name, model] of Object.entries(models)) {
    t.mock.method(model, 'find', (filter) =>
      query(state[name].filter((doc) => matches(doc, filter)))
    );
    t.mock.method(model, 'exists', (filter) =>
      query(state[name].some((doc) => matches(doc, filter)))
    );
    t.mock.method(model, 'deleteMany', async (filter, options) => {
      assert.equal(options.session, session);
      state[name] = state[name].filter((doc) => !matches(doc, filter));
    });
    const update = async (filter, change, options) => {
      assert.equal(options.session, session);
      for (const doc of state[name].filter((doc) => matches(doc, filter))) {
        Object.assign(doc, change.$set || {});
        if (change.$pull)
          doc.subjects = doc.subjects.filter(
            (subject) => !change.$pull.subjects.$in.includes(subject)
          );
      }
    };
    t.mock.method(model, 'updateMany', update);
    t.mock.method(model, 'updateOne', update);
  }
  t.mock.method(mongoose.connection, 'transaction', async (work) => {
    const snapshot = structuredClone(state);
    try {
      return await work(session);
    } catch (error) {
      state = snapshot;
      throw error;
    }
  });
  await assert.rejects(clearData({ ...actor, userId: id(2) }, 'subjects', body([id(5)])), {
    status: 403
  });
  await assert.rejects(clearData(actor, 'subjects', body([id(5), id(99)])), { status: 409 });
  assert.equal(state.Subject.length, 2);
  await clearData(actor, 'subjects', body([id(5)]));
  assert.deepEqual(
    state.Subject.map((doc) => doc._id),
    [id(6)]
  );
  assert.equal(state.Student.length, 2);
  assert.deepEqual(state.Student[0].subjects, []);
  assert.equal(state.Class.length, 2);
  assert.equal(state.Grade.length, 1);
  assert.equal(state.GradeEditRequest.length, 0);
  assert.deepEqual(state.User[1].teacherRoles, ['class-advisor']);
  await clearData(actor, 'classes', body([id(3)]));
  assert.deepEqual(
    state.Student.map((doc) => doc._id),
    [id(8)]
  );
  assert.deepEqual(
    state.Class.map((doc) => doc._id),
    [id(4)]
  );
  assert.deepEqual(state.AcademicAudit, [{ subject: id(6) }]);
  assert.deepEqual(state.User[1].teacherRoles, []);
  assert.equal(state.User.length, 2);
});
