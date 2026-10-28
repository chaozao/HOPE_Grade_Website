// No database connection: exercise the real route and service with a transactional fixture store.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const { validateAssignment } = require('../services/teacher-roles');
const teacherId = '111111111111111111111111';
const otherId = '222222222222222222222222';
const classId = '333333333333333333333333';
const subjectId = '444444444444444444444444';
const otherSubjectId = '555555555555555555555555';

test('role validation requires matching assignments and rejects privilege escalation', () => {
  for (const body of [
    {},
    { roles: ['admin'], subjectIds: [] },
    { roles: ['class-advisor'], subjectIds: [] },
    { roles: ['subject-teacher'], subjectIds: [] },
    { roles: [], advisoryClassId: classId, subjectIds: [] },
    { roles: [], subjectIds: [subjectId] },
    { roles: ['subject-teacher'], subjectIds: ['invalid'] }
  ])
    assert.throws(() => validateAssignment(teacherId, body));
  assert.deepEqual(validateAssignment(teacherId, { roles: [], subjectIds: [] }), {
    advisoryClassId: null,
    subjectIds: []
  });
});

test('assignment routes authorize admins and persist or roll back all assignment changes', async (t) => {
  t.mock.method(require('../services/admin-history'), 'record', async () => {});
  let state;
  let failUserWrite = false;
  const reset = () => {
    failUserWrite = false;
    state = {
      users: [
        { _id: teacherId, role: 'teacher', teacherRoles: [] },
        { _id: otherId, role: 'teacher', teacherRoles: [] }
      ],
      classes: [{ _id: classId, adviser: null }],
      subjects: [
        { _id: subjectId, teacher: null },
        { _id: otherSubjectId, teacher: null }
      ]
    };
  };
  reset();
  const matches = (doc, filter) =>
    Object.entries(filter).every(([key, value]) => {
      if (key === '$or') return value.some(part => matches(doc, part));
      if (value && typeof value === 'object') {
        if ('$in' in value) return value.$in.includes(doc[key]);
        if ('$nin' in value) return !value.$nin.includes(doc[key]);
        if ('$ne' in value) return doc[key] !== value.$ne;
      }
      return doc[key] === value;
    });
  const session = { fixtureSession: true };
  for (const [model, collection] of [
    [User, 'users'],
    [Class, 'classes'],
    [Subject, 'subjects']
  ]) {
    const query = (work) => ({
      session: async (supplied) => {
        assert.equal(supplied, session);
        return work();
      }
    });
    t.mock.method(model, 'find', (filter) =>
      query(() => state[collection].filter((doc) => matches(doc, filter)))
    );
    t.mock.method(model, 'findOne', (filter) =>
      query(() => state[collection].find((doc) => matches(doc, filter)))
    );
    t.mock.method(model, 'findById', (id) =>
      query(() => state[collection].find((doc) => doc._id === id))
    );
    t.mock.method(model, 'exists', (filter) =>
      query(() => state[collection].some((doc) => matches(doc, filter)))
    );
    for (const method of ['updateOne', 'updateMany'])
      t.mock.method(model, method, async (filter, update, options) => {
        assert.equal(options.session, session);
        if (collection === 'users' && failUserWrite) throw new Error('Simulated database failure');
        const docs = state[collection].filter((doc) => matches(doc, filter));
        (method === 'updateOne' ? docs.slice(0, 1) : docs).forEach((doc) =>
          Object.assign(doc, update.$set)
        );
      });
  }
  t.mock.method(mongoose.connection, 'transaction', async (work) => {
    const before = structuredClone(state);
    try {
      await work(session);
    } catch (error) {
      state = before;
      throw error;
    }
  });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'isolated-role-test-secret';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  const app = express();
  app.use(express.json());
  app.use('/admin/teachers', require('../routes/teacher-roles'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const save = async (body, role = 'admin', id = teacherId) => {
    const headers = { 'Content-Type': 'application/json' };
    if (role)
      headers.Authorization =
        'Bearer ' + jwt.sign({ role, userId: otherId }, process.env.JWT_SECRET);
    return fetch('http://127.0.0.1:' + server.address().port + '/admin/teachers/' + id + '/roles', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });
  };
  const both = {
    roles: ['class-advisor', 'subject-teacher'],
    advisoryClassId: classId,
    subjectIds: [subjectId]
  };
  await t.test('teacher and unauthenticated requests cannot assign roles', async () => {
    assert.equal((await save(both, 'teacher')).status, 403);
    assert.equal((await save(both, null)).status, 401);
    assert.deepEqual(state.users[0].teacherRoles, []);
  });
  await t.test('both roles are saved with the actual homeroom and subject links', async () => {
    assert.equal((await save(both)).status, 200);
    assert.deepEqual(state.users[0].teacherRoles, both.roles);
    assert.equal(state.users[0].role, 'teacher');
    assert.equal(state.classes[0].adviser, teacherId);
    assert.equal(state.subjects[0].teacher, teacherId);
  });
  await t.test(
    'removing subject-teacher role releases subjects but preserves homeroom',
    async () => {
      assert.equal(
        (await save({ roles: ['class-advisor'], advisoryClassId: classId, subjectIds: [] })).status,
        200
      );
      assert.deepEqual(state.users[0].teacherRoles, ['class-advisor']);
      assert.equal(state.subjects[0].teacher, null);
      assert.equal(state.classes[0].adviser, teacherId);
    }
  );
  await t.test('subject-only role clears homeroom and supports several subjects', async () => {
    assert.equal(
      (await save({ roles: ['subject-teacher'], subjectIds: [subjectId, otherSubjectId] })).status,
      200
    );
    assert.deepEqual(state.users[0].teacherRoles, ['subject-teacher']);
    assert.equal(state.classes[0].adviser, null);
    assert.ok(state.subjects.every((subject) => subject.teacher === teacherId));
  });
  await t.test(
    'invalid, missing, and occupied assignments cannot change existing records',
    async () => {
      state.classes[0].adviser = otherId;
      const before = structuredClone(state);
      assert.equal((await save(both)).status, 409);
      assert.equal(
        (await save({ ...both, advisoryClassId: '666666666666666666666666' })).status,
        404
      );
      assert.equal((await save({ ...both, roles: ['admin'] })).status, 400);
      assert.equal((await save(both, 'admin', '777777777777777777777777')).status, 404);
      assert.deepEqual(state, before);
    }
  );
  await t.test('database failure rolls back links and user roles', async () => {
    reset();
    failUserWrite = true;
    const before = structuredClone(state);
    assert.equal((await save(both)).status, 500);
    assert.deepEqual(state, before);
  });
  await t.test('clearing roles leaves students and subjects intact but unassigned', async () => {
    reset();
    await save(both);
    assert.equal((await save({ roles: [], subjectIds: [] })).status, 200);
    assert.deepEqual(state.users[0].teacherRoles, []);
    assert.equal(state.classes.length, 1);
    assert.equal(state.classes[0].adviser, null);
    assert.equal(state.subjects.length, 2);
    assert.ok(state.subjects.every((subject) => subject.teacher === null));
  });
});
