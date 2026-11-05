const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const service = require('../services/academic');
const router = require('../routes/academic');

test('PUT activity-order reaches the reorder service and responds with JSON', async (t) => {
  const user = { role: 'teacher', userId: 'teacher1' };
  t.mock.method(jwt, 'verify', () => user);
  const body = { term: 1, category: 'writtenOral', activityIds: ['b', 'a'], version: 1 };
  t.mock.method(service, 'reorderActivities', async (actor, id, input) => {
    assert.deepEqual(actor, user);
    assert.equal(id, 'subject1');
    assert.deepEqual(input, body);
    return { activities: [{ _id: 'b' }, { _id: 'a' }], gradeVersion: 2 };
  });
  const app = express();
  app.use(express.json(), router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/teacher/subjects/subject1/activity-order', {
    method: 'PUT', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { activities: [{ _id: 'b' }, { _id: 'a' }], gradeVersion: 2 });
});
