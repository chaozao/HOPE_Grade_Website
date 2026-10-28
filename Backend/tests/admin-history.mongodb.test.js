// Uses only a unique disposable database; never modifies application records.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const names = ['User', 'Class', 'Subject', 'Student', 'Grade', 'GradeEditRequest', 'AcademicAudit', 'AdminHistory'];
const models = Object.fromEntries(names.map(name => [name, require('../models/' + name)]));
const { User, Class, Subject, AdminHistory: History } = models;
const history = require('../services/admin-history');
const sections = require('../services/section-subjects');
const { assignTeacherRoles } = require('../services/teacher-roles');
const { clearData } = require('../services/clear-data');

test('real database history, author-only undo, conflict protection and permanent clearing',
  { skip: process.env.HOPE_RUN_MONGO_TESTS !== '1', timeout: 120000 }, async t => {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
    const dbName = 'hope_hist_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    await mongoose.connect(process.env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 10000 });
    t.after(async () => {
      assert.match(dbName, /^hope_hist_\d+_[a-f0-9]+$/);
      assert.equal(mongoose.connection.name, dbName);
      try { await Promise.all(Object.values(models).map(model => model.deleteMany({}))); }
      finally { await mongoose.disconnect(); }
    });
    await Promise.all(Object.values(models).map(model => model.init()));
    const [admin, other, teacher] = await User.create(['admin', 'other', 'teacher'].map(name => ({
      username: name, email: name + '@fixture.invalid', password: 'unused', role: name === 'teacher' ? 'teacher' : 'admin'
    })));
    const actor = user => ({ userId: String(user._id), role: user.role });
    const a = actor(admin), b = actor(other);
    const cls = await Class.create({ name: 'Grade 10 - Diamond', adviser: teacher._id });
    const second = await Class.create({ name: 'Grade 11 - Ruby' });
    const latest = () => History.findOne().sort({ _id: -1 });

    // The action and its history must either both persist or both roll back.
    const failedAudit = t.mock.method(History, 'create', async () => { throw new Error('Fixture audit failure'); });
    await assert.rejects(sections.save(a, String(cls._id), null, { name: 'Must roll back', teacherId: '' }), /Fixture audit failure/);
    failedAudit.mock.restore();
    assert.equal(await Subject.countDocuments({ name: 'Must roll back' }), 0);

    let addedClass;
    await mongoose.connection.transaction(async session => {
      [addedClass] = await Class.create([{ name: 'Temporary section' }], { session });
      await history.record(a, 'Added class Temporary section', [history.change('Class', addedClass)], session);
    });
    await history.undo(a, String((await latest())._id));
    assert.equal(await Class.findById(addedClass._id), null);

    await mongoose.connection.transaction(async session => {
      const doc = await User.findById(teacher._id).session(session);
      const before = history.snapshot('User', doc);
      doc.isActive = false;
      await doc.save({ session });
      await history.record(a, 'Deactivated teacher', [history.change('User', doc, before)], session);
    });
    await history.undo(a, String((await latest())._id));
    assert.equal((await User.findById(teacher._id)).isActive, true);

    const { subject } = await sections.save(a, String(cls._id), null, { name: 'Math', teacherId: String(teacher._id) });
    const addition = await latest();
    assert.equal(addition.actorName, 'admin');
    assert.match(addition.action, /Added Math in Grade 10 - Diamond/);
    await assert.rejects(history.undo(b, String(addition._id)), { status: 403 });
    await assert.rejects(history.list(actor(teacher)), { status: 403 });
    assert.equal((await history.list(b)).entries[0].canUndo, false);
    assert.equal((await history.list(a)).entries[0].changes, undefined);

    await sections.save(b, String(cls._id), String(subject._id), { name: 'Science', teacherId: '', version: 0 });
    const edit = await latest();
    const creatorHistory = (await history.list(a)).entries;
    const editorHistory = (await history.list(b)).entries;
    assert.equal(creatorHistory.find(row => String(row._id) === String(addition._id)).canUndo, false);
    assert.equal(creatorHistory.find(row => String(row._id) === String(edit._id)).canUndo, false);
    assert.equal(editorHistory.find(row => String(row._id) === String(edit._id)).canUndo, true);
    await assert.rejects(history.undo(a, String(addition._id)), { status: 409 });
    await assert.rejects(history.undo(a, String(edit._id)), { status: 403 });
    await history.undo(b, String(edit._id));
    assert.equal((await Subject.findById(subject._id)).name, 'Math');
    assert.equal(String((await Subject.findById(subject._id)).teacher), String(teacher._id));
    await assert.rejects(history.undo(b, String(edit._id)), { status: 409 });
    assert.equal((await history.list(a)).entries.find(row => String(row._id) === String(addition._id)).canUndo, false);

    await assignTeacherRoles(String(teacher._id), {
      roles: ['class-advisor', 'subject-teacher'], advisoryClassId: String(second._id), subjectIds: [String(subject._id)]
    }, a);
    const roles = await latest();
    await history.undo(a, String(roles._id));
    assert.equal(String((await Class.findById(cls._id)).adviser), String(teacher._id));
    assert.equal((await Class.findById(second._id)).adviser, null);

    const fresh = await sections.save(a, String(cls._id), null, { name: 'Art', teacherId: '' });
    const freshEntry = await latest();
    const concurrent = await Promise.allSettled([
      history.undo(a, String(freshEntry._id)), history.undo(a, String(freshEntry._id))
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await Subject.findById(fresh.subject._id), null);

    const inUse = await sections.save(a, String(cls._id), null, { name: 'Music', teacherId: '' });
    const inUseEntry = await latest();
    await models.Grade.create({ subject: inUse.subject._id, student: new mongoose.Types.ObjectId() });
    await assert.rejects(history.undo(a, String(inUseEntry._id)), /now in use/);
    assert.ok(await Subject.findById(inUse.subject._id));

    // Creating a teacher can be undone without storing their password in history.
    let created;
    await mongoose.connection.transaction(async session => {
      [created] = await User.create([{ username: 'New teacher', email: 'new@fixture.invalid', password: 'unused', role: 'teacher' }], { session });
      await history.record(a, 'Added teacher New teacher', [history.change('User', created)], session);
    });
    const newTeacherEntry = await latest();
    await history.undo(a, String(newTeacherEntry._id));
    assert.equal(await User.findById(created._id), null);

    // Advisors' edits appear with their name, but cannot be undone by an admin.
    await sections.save(actor(teacher), String(cls._id), String(subject._id), { name: 'Physics', teacherId: String(teacher._id), version: (await Subject.findById(subject._id)).__v });
    const advisorEdit = await latest();
    assert.equal(advisorEdit.actorName, 'teacher');
    await assert.rejects(history.undo(a, String(advisorEdit._id)), { status: 403 });

    await clearData(a, 'classes', { ids: [String(cls._id)], confirmation: 'CLEAR' });
    const cleared = await latest();
    assert.equal(cleared.reversible, false);
    assert.match(cleared.action, /Grade 10 - Diamond/);
    await assert.rejects(history.undo(a, String(cleared._id)), { status: 409 });
    assert.ok(await History.findById(addition._id));
    assert.equal(await Class.findById(cls._id), null);
    assert.equal(await Subject.findById(subject._id), null);
    await assert.rejects(history.undo(a, String(addition._id)), { status: 409 });
  });
