const mongoose = require('mongoose');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const User = require('../models/User');
const P = require('./academic-policy');
const { syncTeacherRoles } = require('./teacher-roles');

async function section(actor, classId, session = null) {
  const user = await User.findOne({ _id: actor.userId, isActive: true }).session(session);
  if (!user || !['admin', 'teacher'].includes(user.role) || user.role !== actor.role) P.fail('Your account cannot manage section subjects.', 403);
  const cls = await Class.findById(P.id(classId, 'section')).session(session);
  if (!cls) P.fail('Section not found.', 404);
  if (user.role !== 'admin' && String(cls.adviser) !== String(user._id)) P.fail('You can only manage subjects in your advisory section.', 403);
  return cls;
}

async function list(actor, classId) {
  const cls = await section(actor, classId);
  return {
    class: { _id: cls._id, name: cls.name },
    subjects: await Subject.find({ class: cls._id }).populate('teacher', 'username email').sort({ name: 1 }),
    teachers: await User.find({ role: 'teacher', isActive: true }).select('username email').sort({ username: 1 })
  };
}

async function save(actor, classId, subjectId, body) {
  let result;
  await mongoose.connection.transaction(async session => {
    const cls = await section(actor, classId, session);
    // Serialize section changes, including concurrent duplicate subject creation.
    await Class.updateOne({ _id: cls._id }, { $inc: { __v: 1 } }, { session });
    const name = P.text(body?.name, 'subject name');
    const teacherId = body?.teacherId ? P.id(body.teacherId, 'teacher') : null;
    if (teacherId && !await User.exists({ _id: teacherId, role: 'teacher', isActive: true }).session(session)) P.fail('Select an active teacher.', 400);
    let subject = subjectId ? await Subject.findOne({ _id: P.id(subjectId, 'subject'), class: cls._id }).session(session) : new Subject({ class: cls._id });
    if (!subject) P.fail('Subject not found in this section.', 404);
    if (subjectId) P.version(body?.version, subject.__v);
    const existing = await Subject.find({ class: cls._id }).select('name').session(session);
    if (existing.some(item => String(item._id) !== String(subject._id) && item.name.trim().toLowerCase() === name.toLowerCase())) P.fail('This subject already exists in this section.', 409);
    const previousTeacher = subject.teacher;
    subject.name = name;
    subject.teacher = teacherId;
    if (subjectId) subject.__v = (subject.__v || 0) + 1;
    await subject.save({ session });
    await syncTeacherRoles(previousTeacher, session);
    if (String(previousTeacher) !== String(teacherId)) await syncTeacherRoles(teacherId, session);
    result = subject;
  });
  return { subject: result };
}
module.exports = { list, save, section };
