const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const Grade = require('../models/Grade');
const Request = require('../models/GradeEditRequest');
const Audit = require('../models/AcademicAudit');
const Attendance = require('../models/Attendance');
const NarrativeReport = require('../models/NarrativeReport');
const CoreValueReport = require('../models/CoreValueReport');
const Leadership = require('../models/SubjectLeadership');
const SchoolTerms = require('../models/SchoolTerms');
const AdminHistory = require('../models/AdminHistory');
const { invalid, validateId } = require('./teacher-roles');
const history = require('./admin-history');

async function clearData(actor, kind, body) {
  if (actor.role !== 'admin') invalid('Only super admins can clear data.', 403);
  if (!['classes', 'subjects', 'school'].includes(kind)) invalid('Choose classes, subjects, or school data.');
  if (body?.confirmation !== 'CLEAR' || (kind !== 'school' && (!Array.isArray(body.ids) || !body.ids.length)))
    invalid('Select records and type CLEAR to confirm.');
  const ids = [...new Set(body.ids || [])];
  ids.forEach((id) => validateId(id, kind));
  return mongoose.connection.transaction(async (session) => {
    const admin = await User.findById(actor.userId).session(session);
    if (!admin || admin.role !== 'admin' || !admin.isActive)
      invalid('Your admin account is unavailable.', 403);
    if (kind === 'school') {
      // Keep identities and role assignments; remove only enrollment links from students.
      await Class.updateMany({}, { $inc: { __v: 1 } }, { session });
      await Student.updateMany({}, { $set: { class: null, subjects: [] }, $inc: { recordVersion: 1 } }, { session });
      for (const model of [Subject, Class, Grade, Request, Audit, Attendance, NarrativeReport, CoreValueReport, Leadership, SchoolTerms, AdminHistory])
        await model.deleteMany({}, { session });
      return { message: 'School data and modification history cleared. Accounts, roles, and student profiles are preserved.' };
    }
    const model = kind === 'classes' ? Class : Subject;
    const selected = await model.find({ _id: { $in: ids } }).session(session);
    if (selected.length !== ids.length)
      invalid('Some records no longer exist. Refresh the table before clearing data.', 409);
    const classIds = kind === 'classes' ? ids : [];
    // Lock parent sections against concurrent subject creation or reassignment.
    const parentIds = kind === 'classes' ? ids : selected.map((item) => item.class);
    await Class.updateMany({ _id: { $in: parentIds } }, { $inc: { __v: 1 } }, { session });
    const subjects =
      kind === 'classes' ? await Subject.find({ class: { $in: ids } }).session(session) : selected;
    const subjectIds = subjects.map((item) => item._id);
    const students = await Student.find({ class: { $in: classIds } })
      .select('_id')
      .session(session);
    const studentIds = students.map((item) => item._id);
    const requests = await Request.find({
      $or: [{ subject: { $in: subjectIds } }, { class: { $in: classIds } }]
    })
      .select('_id')
      .session(session);
    await Subject.deleteMany({ _id: { $in: subjectIds } }, { session });
    await Grade.deleteMany(
      { $or: [{ subject: { $in: subjectIds } }, { student: { $in: studentIds } }] },
      { session }
    );
    await Request.deleteMany({ _id: { $in: requests.map((item) => item._id) } }, { session });
    for (const report of [Attendance, NarrativeReport, CoreValueReport]) {
      await report.deleteMany({ $or: [{ subject: { $in: subjectIds } }, { student: { $in: studentIds } }] }, { session });
    }
    await Audit.deleteMany(
      {
        $or: [
          { subject: { $in: subjectIds } },
          { student: { $in: studentIds } },
          { request: { $in: requests.map((item) => item._id) } }
        ]
      },
      { session }
    );
    await Student.updateMany({ _id: { $in: studentIds } },
      { $set: { class: null, subjects: [] }, $inc: { recordVersion: 1 } }, { session });
    await Student.updateMany(
      { subjects: { $in: subjectIds } },
      { $pull: { subjects: { $in: subjectIds } }, $inc: { recordVersion: 1 } },
      { session }
    );
    await Class.deleteMany({ _id: { $in: classIds } }, { session });
    await history.record(actor, 'Cleared ' + kind + ': ' +
      selected.map(item => item.name || String(item._id)).join(', ') +
      ' — permanently deleted linked data', [], session, false);
    return {
      message: 'Data cleared from admin, adviser, and subject teacher records.',
      removed: {
        classes: classIds.length,
        subjects: subjectIds.length,
        students: 0,
        detachedStudents: studentIds.length
      }
    };
  });
}
module.exports = { clearData };
