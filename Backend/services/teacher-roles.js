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

async function assignTeacherRoles(teacherId, body) {
  const { advisoryClassId, subjectIds } = validateAssignment(teacherId, body);
  // Atlas transactions keep user roles and class/subject links in sync on failure.
  await mongoose.connection.transaction(async (session) => {
    await requireTeacher(teacherId, session);
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
