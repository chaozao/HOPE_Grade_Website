const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const router = require('../routes/academic');

test('attendance HTTP query loads the roster by date without requiring a term', async (t) => {
  const actor = { role: 'teacher', userId: '3'.repeat(24) };
  const id = '1'.repeat(24), studentId = '2'.repeat(24);
  const query = (value) => ({ session: async () => value, sort: async () => value });
  t.mock.method(jwt, 'verify', () => actor);
  t.mock.method(User, 'findOne', () => query({}));
  t.mock.method(Subject, 'findById', () => query({ _id: id, teacher: actor.userId }));
  t.mock.method(Student, 'find', () => query([{ _id: studentId, firstName: 'Ben', lastName: 'Alba' }]));
  t.mock.method(Attendance, 'ensureTermIndex', async () => {});
  t.mock.method(Attendance, 'find', async (filter) => {
    assert.equal(filter.term, undefined);
    return [{ student: studentId, date: filter.date, status: 'absent' }];
  });
  const app = express(); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const get = (suffix) => fetch('http://127.0.0.1:' + server.address().port + '/teacher/subjects/' + id + '/attendance?date=2026-11-10' + suffix, { headers: { Authorization: 'Bearer test' } });
  const response = await get('');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.roster[0].firstName, 'Ben');
  assert.equal(data.roster[0].status, 'absent');
});
