const { test } = require('node:test');
const assert = require('node:assert/strict');
const history = require('../services/admin-history');

test('undo eligibility belongs only to the original actor and excludes permanent actions', () => {
  const entry = { actor: 'alice', reversible: true };
  assert.equal(history.canUndo(entry, { userId: 'alice' }), true);
  assert.equal(history.canUndo(entry, { userId: 'bob' }), false);
  assert.equal(history.canUndo({ ...entry, reversible: false }, { userId: 'alice' }), false);
  assert.equal(history.canUndo({ ...entry, undoneAt: new Date() }, { userId: 'alice' }), false);
});
test('history snapshots never store credentials or student/grade contents', () => {
  const snapshot = history.snapshot('User', { username: 'Alice', password: 'secret', resetTokenHash: 'secret' });
  assert.equal(snapshot.password, undefined);
  assert.equal(snapshot.resetTokenHash, undefined);
  assert.equal(history.snapshot('Subject', { name: 'Math', activities: ['private'] }).activities, undefined);
});
