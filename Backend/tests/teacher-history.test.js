const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Audit = require('../models/AcademicAudit');
const { teacherModificationHistory } = require('../services/academic');

test('teacher history is restricted to currently assigned subjects and active teachers', async t => {
  const actor = { role: 'teacher', userId: 'teacher-1' };
  let active = true, assigned = [{ _id: 'owned-subject' }];
  t.mock.method(User, 'findOne', filter => {
    assert.deepEqual(filter, { _id: actor.userId, role: 'teacher', isActive: true });
    return { session: async () => active ? { _id: actor.userId } : null };
  });
  t.mock.method(Subject, 'find', filter => {
    assert.deepEqual(filter, { teacher: actor.userId });
    return { select: async () => assigned };
  });
  t.mock.method(Audit, 'find', filter => {
    assert.deepEqual(filter, { subject: { $in: assigned.map(s => s._id) } });
    const query = {
      select: () => query, populate: () => query,
      sort: order => { assert.deepEqual(order, { createdAt: -1 }); return query; },
      limit: async count => { assert.equal(count, 100); return assigned.length ? [{ action: 'grades-saved' }] : []; }
    };
    return query;
  });
  assert.deepEqual(await teacherModificationHistory(actor), [{ action: 'grades-saved' }]);
  assigned = [];
  assert.deepEqual(await teacherModificationHistory(actor), []);
  active = false;
  await assert.rejects(teacherModificationHistory(actor), { status: 403 });
  await assert.rejects(teacherModificationHistory({ ...actor, role: 'admin' }), { status: 403 });
});
