const mongoose = require('mongoose');
const History = require('../models/AdminHistory');
const User = require('../models/User');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const Grade = require('../models/Grade');
const Request = require('../models/GradeEditRequest');
const Audit = require('../models/AcademicAudit');
const models = { User, Class, Subject };
const fields = {
  User: ['username', 'email', 'role', 'isActive'],
  Class: ['name', 'gradeLevel', 'section', 'adviser'],
  Subject: ['name', 'class', 'teacher']
};
function fail(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function snapshot(model, doc) {
  if (!doc) return null;
  return JSON.parse(JSON.stringify(Object.fromEntries(
    [...fields[model], 'updatedAt', '__v'].map(key => [key, doc[key] ?? null])
  )));
}
function change(model, doc, before = null) {
  return { model, target: doc._id, before, after: snapshot(model, doc) };
}
async function record(actor, action, changes, session, reversible = true) {
  const user = await User.findById(actor.userId).session(session);
  if (!user || !user.isActive || user.role !== actor.role) fail('Your account is unavailable.', 403);
  await History.create([{
    actor: user._id, actorName: user.username, action, changes, reversible
  }], { session });
}
async function admin(actor) {
  const user = await User.findById(actor.userId);
  if (!user || !user.isActive || user.role !== 'admin' || actor.role !== 'admin')
    fail('Only active super admins can view this history.', 403);
}
function canUndo(entry, actor) {
  return entry.reversible && !entry.undoneAt && String(entry.actor) === String(actor.userId);
}
async function hasNewerChange(entry, session = null) {
  if (!entry.changes.length) return true;
  return Boolean(await History.exists({
    _id: { $gt: entry._id },
    $or: entry.changes.map(item => ({
      changes: { $elemMatch: { model: item.model, target: item.target } }
    }))
  }).session(session));
}
async function availableUndo(entry, actor) {
  if (!canUndo(entry, actor) || await hasNewerChange(entry)) return false;
  const current = await Promise.all(entry.changes.map(async item => {
    const doc = await models[item.model].findById(item.target);
    return Boolean(doc) && JSON.stringify(snapshot(item.model, doc)) === JSON.stringify(item.after);
  }));
  return current.every(Boolean);
}
async function list(actor, before) {
  await admin(actor);
  if (before && !mongoose.isObjectIdOrHexString(before)) fail('Invalid history page.', 400);
  const rows = await History.find(before ? { _id: { $lt: before } } : {})
    .sort({ _id: -1 }).limit(51).lean();
  return {
    next: rows.length > 50 ? String(rows[49]._id) : null,
    entries: await Promise.all(rows.slice(0, 50).map(async entry => ({
      _id: entry._id, name: entry.actorName, action: entry.action,
      date: entry.createdAt, undoneAt: entry.undoneAt,
      reversible: entry.reversible, canUndo: await availableUndo(entry, actor)
    })))
  };
}
async function ensureNoDependents(model, doc, session) {
  const exists = (Model, filter) => Model.exists(filter).session(session);
  let used;
  if (model === 'User') {
    used = await exists(Class, { adviser: doc._id }) || await exists(Subject, { teacher: doc._id }) ||
      await exists(History, { actor: doc._id }) || await exists(Audit, { actor: doc._id });
  } else if (model === 'Class') {
    used = await exists(Subject, { class: doc._id }) || await exists(Student, { class: doc._id }) ||
      await exists(Request, { class: doc._id });
  } else {
    used = doc.activities?.length || doc.gradeStatus === 'finalized' ||
      await exists(Grade, { subject: doc._id }) || await exists(Student, { subjects: doc._id }) ||
      await exists(Request, { subject: doc._id }) || await exists(Audit, { subject: doc._id });
  }
  if (used) fail('This record is now in use. Remove its later assignments or changes before undoing its creation.');
}
async function undo(actor, id) {
  await admin(actor);
  if (!mongoose.isObjectIdOrHexString(id)) fail('Invalid history entry.', 400);
  return mongoose.connection.transaction(async session => {
    const entry = await History.findById(id).session(session);
    if (!entry) fail('History entry not found.', 404);
    if (String(entry.actor) !== String(actor.userId)) fail('Only the person who made this change can undo it.', 403);
    if (!entry.reversible) fail('Clear Data cannot be undone.');
    if (entry.undoneAt) fail('This change has already been undone.');
    if (await hasNewerChange(entry, session))
      fail('A newer change exists for this record. Only its latest change can be undone.');
    const teachers = new Set();
    // Release a newly assigned homeroom before restoring the former homeroom.
    const changes = [...entry.changes].sort((a, b) =>
      Number(a.model !== 'Class') - Number(b.model !== 'Class') ||
      Number(Boolean(a.before?.adviser)) - Number(Boolean(b.before?.adviser)));
    const prepared = [];
    for (const item of changes) {
      const Model = models[item.model];
      const doc = await Model.findById(item.target).session(session);
      if (!doc || JSON.stringify(snapshot(item.model, doc)) !== JSON.stringify(item.after))
        fail('This record was changed or cleared after this action. Undo is no longer available.');
      prepared.push({ item, Model, doc });
    }
    // Validate the entire saved state before our own section locks change it.
    for (const { item, Model, doc } of prepared) {
      for (const state of [item.before, item.after]) {
        if (state?.teacher) teachers.add(String(state.teacher));
        if (state?.adviser) teachers.add(String(state.adviser));
      }
      if (item.model === 'Subject') {
        // Serialize both restoration and removal with enrollment/subject changes.
        const locked = await Class.updateOne(
          { _id: (item.before || item.after).class }, { $inc: { __v: 1 } }, { session });
        if (!locked.matchedCount) fail('The original section no longer exists.');
      }
      if (!item.before) {
        await ensureNoDependents(item.model, doc, session);
        await Model.deleteOne({ _id: doc._id }, { session });
      } else {
        // Restore only editable fields, never timestamps, versions or credentials.
        if (item.model === 'Subject') {
          if (!(await Class.exists({ _id: item.before.class }).session(session)))
            fail('The original section no longer exists.');
          const duplicates = await Subject.find({ class: item.before.class, _id: { $ne: doc._id } }).session(session);
          if (duplicates.some(other => other.name.trim().toLowerCase() === item.before.name.trim().toLowerCase()))
            fail('Another subject now uses the original name in this section.');
        }
        const teacherId = item.before.teacher || item.before.adviser;
        if (teacherId) {
          const teacher = await User.findById(teacherId).session(session);
          if (!teacher || teacher.role !== 'teacher' || !teacher.isActive)
            fail('The original teacher is no longer available.');
          if (item.model === 'Class' && await Class.exists({ adviser: teacherId, _id: { $ne: doc._id } }).session(session))
            fail('The original advisor now has another homeroom.');
        }
        for (const key of fields[item.model]) doc[key] = item.before[key];
        doc.__v = (doc.__v || 0) + 1;
        await doc.save({ session });
      }
    }
    for (const teacherId of teachers)
      await require('./teacher-roles').syncTeacherRoles(teacherId, session);
    entry.undoneAt = new Date();
    await entry.save({ session });
    await record(actor, 'Undid: ' + entry.action, [], session, false);
    return { message: 'Change undone.' };
  });
}
module.exports = { snapshot, change, record, list, undo, canUndo };
