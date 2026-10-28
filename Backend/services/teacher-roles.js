const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Subject = require('../models/Subject');

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validateId(id, label) {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))
    invalid('Select a valid ' + label + '.');
}

async function requireTeacher(id, session) {
  validateId(id, 'teacher');
  const teacher = await User.findOne({ _id: id, role: 'teacher' }).session(session);
  if (!teacher) invalid('Teacher not found.', 404);
  return teacher;
}

async function syncTeacherRoles(id, session) {
  if (!id) return;
  const roles = [];
  if (await Class.exists({ adviser: id }).session(session)) roles.push('class-advisor');
  if (await Subject.exists({ teacher: id }).session(session)) roles.push('subject-teacher');
  // Also writes the User document to serialize concurrent assignments for one teacher.
  await User.updateOne(
    { _id: id, role: 'teacher' },
    { $set: { teacherRoles: roles } },
    { session, runValidators: true }
  );
}

function validateAssignment(teacherId, body) {
  validateId(teacherId, 'teacher');
  if (!body || !Array.isArray(body.roles) || !Array.isArray(body.subjectIds))
    invalid('Choose roles and their assignments.');
  const roles = [...new Set(body.roles)];
  if (roles.some((role) => !['class-advisor', 'subject-teacher'].includes(role)))
    invalid('Invalid teacher role.');
  const advisoryClassId = body.advisoryClassId || null;
  const subjectIds = [...new Set(body.subjectIds)];
  if (roles.includes('class-advisor')) validateId(advisoryClassId, 'homeroom');
  else if (advisoryClassId) invalid('Select Class Advisor to assign a homeroom.');
  if (roles.includes('subject-teacher') && !subjectIds.length)
    invalid('Select at least one teaching subject.');
  if (!roles.includes('subject-teacher') && subjectIds.length)
    invalid('Select Subject Teacher to assign subjects.');
  subjectIds.forEach((id) => validateId(id, 'subject'));
  return { advisoryClassId, subjectIds };
}

async function assignTeacherRoles(teacherId, body, actor) {
  const { advisoryClassId, subjectIds } = validateAssignment(teacherId, body);
  // Atlas transactions keep user roles and class/subject links in sync on failure.
  await mongoose.connection.transaction(async (session) => {
    const teacher = await requireTeacher(teacherId, session);
    const history = require('./admin-history');
    const previous = [];
    if (actor) {
      const classes = await Class.find({ $or: [{ adviser: teacherId }, { _id: advisoryClassId }] }).session(session);
      const assigned = await Subject.find({ $or: [{ teacher: teacherId }, { _id: { $in: subjectIds } }] }).session(session);
      for (const doc of classes) previous.push({ model: 'Class', id: doc._id, before: history.snapshot('Class', doc) });
      for (const doc of assigned) previous.push({ model: 'Subject', id: doc._id, before: history.snapshot('Subject', doc) });
    }
    if (advisoryClassId) {
      const homeroom = await Class.findById(advisoryClassId).session(session);
      if (!homeroom) invalid('Homeroom not found. Reload the assignments.', 404);
      if (homeroom.adviser && String(homeroom.adviser) !== teacherId) {
        invalid('This homeroom already has another advisor. Remove that assignment first.', 409);
      }
    }
    const subjects = await Subject.find({ _id: { $in: subjectIds } }).session(session);
    if (subjects.length !== subjectIds.length)
      invalid('A selected subject no longer exists. Reload the assignments.', 404);
    if (subjects.some((subject) => subject.teacher && String(subject.teacher) !== teacherId)) {
      invalid('A selected subject already has another teacher. Remove that assignment first.', 409);
    }

    await Class.updateMany(
      { adviser: teacherId, _id: { $ne: advisoryClassId } },
      { $set: { adviser: null } },
      { session }
    );
    if (advisoryClassId)
      await Class.updateOne(
        { _id: advisoryClassId },
        { $set: { adviser: teacherId } },
        { session }
      );
    await Subject.updateMany(
      { teacher: teacherId, _id: { $nin: subjectIds } },
      { $set: { teacher: null } },
      { session }
    );
    if (subjectIds.length)
      await Subject.updateMany(
        { _id: { $in: subjectIds } },
        { $set: { teacher: teacherId } },
        { session }
      );
    await syncTeacherRoles(teacherId, session);
    if (actor) {
      const changes = [];
      for (const item of previous) {
        const doc = await (item.model === 'Class' ? Class : Subject).findById(item.id).session(session);
        changes.push(history.change(item.model, doc, item.before));
      }
      await history.record(actor, 'Modified roles and assignments for ' + teacher.username, changes, session);
    }
  });
}

module.exports = {
  assignTeacherRoles,
  syncTeacherRoles,
  requireTeacher,
  validateId,
  validateAssignment,
  invalid
};
