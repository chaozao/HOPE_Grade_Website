const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const Grade = require('../models/Grade');
const EditRequest = require('../models/GradeEditRequest');
const Audit = require('../models/AcademicAudit');
const P = require('./academic-policy');

async function teacher(actor, session = null) {
  if (actor.role !== 'teacher') P.fail('Only teachers can use this workflow.', 403);
  const user = await User.findOne({ _id: actor.userId, role: 'teacher', isActive: true }).session(
    session
  );
  if (!user) P.fail('Your teaching account is unavailable.', 403);
  return user;
}
async function adviser(actor, session = null) {
  await teacher(actor, session);
  const classes = await Class.find({ adviser: actor.userId }).session(session);
  if (!classes.length)
    P.fail('Only a class adviser can manage student records or advisory grades.', 403);
  return classes;
}
async function ownedSubject(actor, subjectId, session = null) {
  await teacher(actor, session);
  const subject = await Subject.findById(P.id(subjectId, 'subject')).session(session);
  if (!subject) P.fail('Subject not found.', 404);
  if (String(subject.teacher) !== actor.userId) P.fail('This is not your assigned subject.', 403);
  return subject;
}
async function audit(actor, action, data, session) {
  await Audit.create([{ actor: actor.userId, action, ...data }], { session });
}
async function touch(subject, session, gradeChange = true) {
  subject.workflowRevision = (subject.workflowRevision || 0) + 1;
  if (gradeChange) subject.gradeVersion = (subject.gradeVersion || 0) + 1;
  await subject.save({ session });
}
async function roster(subject, session = null) {
  const students = await Student.find(P.rosterFilter(subject))
    .sort({ lastName: 1, firstName: 1 })
    .session(session);
  const grades = await Grade.find({
    subject: subject._id,
    student: { $in: students.map((s) => s._id) }
  }).session(session);
  const byStudent = new Map(grades.map((g) => [String(g.student), g]));
  return students.map((student) => {
    const source = byStudent.get(String(student._id))?.scores || {};
    const scores = Object.fromEntries(P.scoreFields.map((field) => [field, source[field] ?? null]));
    return {
      studentId: student._id,
      lrn: student.lrn || '',
      firstName: student.firstName,
      lastName: student.lastName,
      middleName: student.middleName || student.middleInitial || '',
      gender: student.gender,
      gradeLevel: student.gradeLevel || '',
      scores,
      weightedGrade: P.weightedGrade(scores),
      activityScores: Object.fromEntries(byStudent.get(String(student._id))?.activityScores || [])
    };
  });
}
async function teacherRoster(actor, subjectId) {
  const subject = await ownedSubject(actor, subjectId);
  const rows = await roster(subject);
  const cls = await Class.findById(subject.class).populate('adviser', 'username');
  const requests = await EditRequest.find({ subject: subject._id })
    .populate('reviewedBy', 'username')
    .sort({ createdAt: -1 })
    .limit(10);
  const graded = rows.filter((row) => row.weightedGrade !== null);
  return {
    subjectId: subject._id,
    subjectName: subject.name,
    className: cls?.name || 'Class unavailable',
    adviserName: cls?.adviser?.username || '',
    canRequestEdit: Boolean(cls?.adviser),
    gradeStatus: subject.gradeStatus || 'draft',
    gradeVersion: subject.gradeVersion || 0,
    finalizedAt: subject.finalizedAt,
    requests,
    totalStudents: rows.length,
    classAverage: graded.length
      ? Number((graded.reduce((sum, row) => sum + row.weightedGrade, 0) / graded.length).toFixed(1))
      : null,
    passingRate: graded.length
      ? Number(
          ((graded.filter((row) => row.weightedGrade >= 75).length / graded.length) * 100).toFixed(
            1
          )
        )
      : null,
    roster: rows,
    activities: subject.activities || []
  };
}
async function mySubjects(actor) {
  await teacher(actor);
  const subjects = await Subject.find({ teacher: actor.userId }).populate('class', 'name');
  return Promise.all(
    subjects.map(async (subject) => ({
      _id: subject._id,
      name: subject.name,
      classId: subject.class?._id || null,
      className: subject.class?.name || 'Class unavailable',
      gradeStatus: subject.gradeStatus || 'draft',
      studentCount: await Student.countDocuments(P.rosterFilter(subject))
    }))
  );
}
function validateWSPercentage(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100)
    P.fail('WS Percentage must be greater than 0 and at most 100.');
  return value;
}
async function addActivity(actor, subjectId, body) {
  if (![1, 2, 3].includes(body?.term)) P.fail('Select a valid term.');
  if (!['writtenOral', 'performanceTasks', 'examination'].includes(body?.category))
    P.fail('Select a valid activity category.');
  const title = P.text(body?.title, 'activity title', 100);
  const wsPercentage = body.category === 'examination' ? validateWSPercentage(body.wsPercentage) : undefined;
  if (!Number.isInteger(body?.maxScore) || body.maxScore < 1 || body.maxScore > 10000)
    P.fail('Maximum score must be a whole number from 1 to 10000.');
  let result;
  await mongoose.connection.transaction(async (session) => {
    const subject = await ownedSubject(actor, subjectId, session);
    P.requireDraft(subject);
    P.version(body.version, subject.gradeVersion);
    subject.activities ||= [];
    if (
      subject.activities.filter(
        (item) => item.term === body.term && item.category === body.category
      ).length >= 100
    )
      P.fail('This category already has 100 activities.');
    subject.activities.push({
      term: body.term,
      category: body.category,
      title,
      maxScore: body.maxScore,
      wsPercentage
    });
    await touch(subject, session);
    await audit(
      actor,
      'activity-added',
      {
        subject: subject._id,
        details: { term: body.term, category: body.category, title, maxScore: body.maxScore, wsPercentage }
      },
      session
    );
    result = { activities: subject.activities, gradeVersion: subject.gradeVersion };
  });
  return result;
}
async function changeActivity(actor, subjectId, activityId, body, remove = false) {
  activityId = P.id(activityId, 'activity');
  const title = remove ? null : P.text(body?.title, 'activity title', 100);
  if (!remove && (!Number.isInteger(body?.maxScore) || body.maxScore < 1 || body.maxScore > 10000))
    P.fail('Maximum score must be a whole number from 1 to 10000.');
  let result;
  await mongoose.connection.transaction(async (session) => {
    const subject = await ownedSubject(actor, subjectId, session);
    P.requireDraft(subject);
    P.version(body?.version, subject.gradeVersion);
    const activity = subject.activities.id(activityId);
    if (!activity) P.fail('Activity not found. Reload the class.', 404);
    const before = activity.toObject();
    if (
      !remove &&
      body.maxScore < activity.maxScore &&
      (await Grade.exists({
        subject: subject._id,
        ['activityScores.' + activityId]: { $gt: body.maxScore }
      }).session(session))
    ) {
      P.fail(
        'Maximum points cannot be lower than an existing student score. Update those scores first.',
        409
      );
    }
    if (remove)
      await Grade.updateMany(
        { subject: subject._id },
        { $unset: { ['activityScores.' + activityId]: '' } },
        { session }
      );
    if (remove) activity.deleteOne();
    else {
      activity.title = title;
      activity.maxScore = body.maxScore;
      if (activity.category === 'examination' && body.wsPercentage !== undefined)
        activity.wsPercentage = validateWSPercentage(body.wsPercentage);
    }
    await touch(subject, session);
    await audit(
      actor,
      remove ? 'activity-deleted' : 'activity-updated',
      { subject: subject._id, details: { before, after: remove ? null : activity.toObject() } },
      session
    );
    result = { activities: subject.activities, gradeVersion: subject.gradeVersion };
  });
  return result;
}
async function saveActivityScores(actor, subjectId, body) {
  let gradeVersion;
  await mongoose.connection.transaction(async (session) => {
    const subject = await ownedSubject(actor, subjectId, session);
    P.requireDraft(subject);
    P.version(body?.version, subject.gradeVersion);
    const students = await Student.find(P.rosterFilter(subject)).select('_id').session(session);
    const entries = P.validateActivityScores(
      body?.grades,
      students.map((student) => student._id),
      subject.activities || [],
      body?.term
    );
    const before = await Grade.find({
      subject: subject._id,
      student: { $in: entries.map((entry) => entry.studentId) }
    })
      .lean()
      .session(session);
    await touch(subject, session);
    for (const entry of entries) {
      const updates = { updatedBy: actor.userId };
      for (const [activityId, score] of Object.entries(entry.scores))
        updates['activityScores.' + activityId] = score;
      await Grade.findOneAndUpdate(
        { subject: subject._id, student: entry.studentId },
        { $set: updates },
        { session, upsert: true, runValidators: true }
      );
    }
    await audit(
      actor,
      'grades-saved',
      { subject: subject._id, details: { term: body.term, before, after: entries } },
      session
    );
    gradeVersion = subject.gradeVersion;
  });
  return { message: 'Activity scores saved.', gradeVersion };
}
async function saveGrades(actor, subjectId, body) {
  let gradeVersion;
  await mongoose.connection.transaction(async (session) => {
    const subject = await ownedSubject(actor, subjectId, session);
    P.requireDraft(subject);
    P.version(body?.version, subject.gradeVersion);
    const students = await Student.find(P.rosterFilter(subject)).select('_id').session(session);
    const entries = P.validateGrades(
      body?.grades,
      students.map((s) => s._id)
    );
    const before = await Grade.find({
      subject: subject._id,
      student: { $in: entries.map((e) => e.studentId) }
    })
      .lean()
      .session(session);
    await touch(subject, session);
    for (const entry of entries) {
      await Grade.findOneAndUpdate(
        { student: entry.studentId, subject: subject._id },
        { $set: { scores: entry.scores, updatedBy: actor.userId } },
        { session, upsert: true, runValidators: true }
      );
    }
    await audit(
      actor,
      'grades-saved',
      { subject: subject._id, details: { before, after: entries } },
      session
    );
    gradeVersion = subject.gradeVersion;
  });
  return { message: 'Grades saved.', gradeVersion };
}
async function finalize(actor, subjectId, body) {
  await mongoose.connection.transaction(async (session) => {
    const subject = await ownedSubject(actor, subjectId, session);
    P.requireDraft(subject);
    P.version(body?.version, subject.gradeVersion);
    const cls = await Class.findById(subject.class).session(session);
    if (!cls?.adviser)
      P.fail('Ask the super admin to assign a class adviser before finalizing grades.', 409);
    const rows = await roster(subject, session);
    P.requireComplete(rows);
    subject.gradeStatus = 'finalized';
    subject.finalizedAt = new Date();
    subject.finalizedBy = actor.userId;
    await touch(subject, session);
    await audit(
      actor,
      'grades-finalized',
      { subject: subject._id, details: { gradeVersion: subject.gradeVersion, grades: rows } },
      session
    );
  });
  return { message: 'Grades finalized and locked.' };
}
async function requestEdit(actor, subjectId, body) {
  const reason = P.text(body?.reason, 'reason for reopening', 1000);
  await mongoose.connection.transaction(async (session) => {
    const subject = await ownedSubject(actor, subjectId, session);
    if (subject.gradeStatus !== 'finalized')
      P.fail('Only finalized grades require reopening.', 409);
    P.version(body?.version, subject.gradeVersion);
    const cls = await Class.findById(subject.class).session(session);
    if (!cls?.adviser) P.fail('The subject’s class has no adviser. Contact the super admin.', 409);
    if (await EditRequest.exists({ subject: subject._id, status: 'pending' }).session(session))
      P.fail('An edit request is already pending for this subject.', 409);
    await touch(subject, session, false);
    const [request] = await EditRequest.create(
      [
        {
          subject: subject._id,
          class: subject.class,
          requestedBy: actor.userId,
          reason,
          gradeVersion: subject.gradeVersion || 0
        }
      ],
      { session }
    );
    await audit(
      actor,
      'reopening-requested',
      { subject: subject._id, request: request._id, details: { reason } },
      session
    );
  });
  return {
    message: 'Edit request sent to the class adviser. Grades remain locked until approved.'
  };
}
async function requestsForAdviser(actor) {
  const classes = await adviser(actor);
  return EditRequest.find({ class: { $in: classes.map((cls) => cls._id) } })
    .populate('subject', 'name gradeStatus')
    .populate('class', 'name')
    .populate('requestedBy', 'username')
    .populate('reviewedBy', 'username')
    .sort({ createdAt: -1 });
}
async function myRequests(actor) {
  await teacher(actor);
  const subjects = await Subject.find({ teacher: actor.userId }).select('_id');
  return EditRequest.find({
    requestedBy: actor.userId,
    subject: { $in: subjects.map((subject) => subject._id) }
  })
    .populate('subject', 'name')
    .populate('class', 'name')
    .populate('reviewedBy', 'username')
    .sort({ createdAt: -1 });
}
async function teacherModificationHistory(actor) {
  await teacher(actor);
  const subjects = await Subject.find({ teacher: actor.userId }).select('_id');
  return Audit.find({ subject: { $in: subjects.map((subject) => subject._id) } })
    .select('action subject actor createdAt')
    .populate('subject', 'name')
    .populate('actor', 'username')
    .sort({ createdAt: -1 })
    .limit(100);
}
async function modificationHistory(actor) {
  const classes = await adviser(actor);
  const subjects = await Subject.find({
    $or: [{ class: { $in: classes.map((cls) => cls._id) } }, { teacher: actor.userId }]
  }).select('_id');
  return Audit.find({ subject: { $in: subjects.map((subject) => subject._id) } })
    .select('action subject actor createdAt')
    .populate('subject', 'name')
    .populate('actor', 'username')
    .sort({ createdAt: -1 })
    .limit(100);
}
async function reviewRequest(actor, requestId, body) {
  P.id(requestId, 'edit request');
  if (!['approved', 'rejected'].includes(body?.decision)) P.fail('Choose approve or reject.');
  const note = P.text(body.note, 'review note', 1000, true);
  await mongoose.connection.transaction(async (session) => {
    await adviser(actor, session);
    const request = await EditRequest.findById(requestId).session(session);
    if (!request) P.fail('Edit request not found.', 404);
    const cls = await Class.findOne({ _id: request.class, adviser: actor.userId }).session(session);
    if (!cls) P.fail('Only the adviser of this subject’s class may review this request.', 403);
    if (request.status !== 'pending') P.fail('This request has already been reviewed.', 409);
    const subject = await Subject.findById(request.subject).session(session);
    if (!subject || String(subject.class) !== String(cls._id))
      P.fail('The subject’s class assignment changed. Reload the request.', 409);
    if (body.decision === 'approved') {
      if (
        subject.gradeStatus !== 'finalized' ||
        subject.gradeVersion !== request.gradeVersion ||
        String(subject.teacher) !== String(request.requestedBy)
      ) {
        P.fail(
          'This request is outdated. Reject it and ask the current subject teacher to send a new request.',
          409
        );
      }
      subject.gradeStatus = 'draft';
      subject.finalizedAt = null;
      subject.finalizedBy = null;
    }
    await touch(subject, session, body.decision === 'approved');
    request.status = body.decision;
    request.reviewNote = note;
    request.reviewedBy = actor.userId;
    request.reviewedAt = new Date();
    await request.save({ session });
    await audit(
      actor,
      'reopening-' + body.decision,
      { subject: subject._id, request: request._id, details: { note } },
      session
    );
  });
  return {
    message:
      body.decision === 'approved'
        ? 'Request approved. The subject teacher can edit and must finalize again.'
        : 'Request rejected. Grades remain locked.'
  };
}
async function studentOptions(actor) {
  await adviser(actor);
  const classes = await Class.find().populate('adviser', 'username').sort({ name: 1 });
  const subjects = await Subject.find().populate('teacher', 'username').sort({ name: 1 });
  const rosterGrades = await Student.aggregate([
    { $group: { _id: { classId: '$class', gradeLevel: '$gradeLevel' } } }
  ]);
  return { classes, subjects, rosterGrades: rosterGrades.map((row) => row._id) };
}
async function listStudents(actor, query) {
  await adviser(actor);
  const filter = {};
  if (query.classId) filter.class = P.id(query.classId, 'class');
  if (query.gradeLevel) {
    const gradeLevel = P.text(query.gradeLevel, 'grade level', 40);
    const classes = await Class.find({ gradeLevel }).select('_id');
    filter.$and = [
      {
        $or: [
          { gradeLevel },
          { gradeLevel: { $in: ['', null] }, class: { $in: classes.map((cls) => cls._id) } }
        ]
      }
    ];
  }
  if (query.subjectId) {
    const subject = await Subject.findById(P.id(query.subjectId, 'subject'));
    if (!subject) P.fail('Subject not found.', 404);
    filter.$and = [...(filter.$and || []), P.rosterFilter(subject)];
  }
  const search = P.text(query.q, 'search', 100, true);
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = ['lrn', 'firstName', 'lastName', 'middleName'].map((field) => ({
      [field]: regex
    }));
  }
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = 25;
  const total = await Student.countDocuments(filter);
  const students = await Student.find(filter)
    .populate('class', 'name gradeLevel section')
    .collation({ locale: 'en', strength: 2 })
    .sort({ lastName: 1, firstName: 1, _id: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  const subjects = await Subject.find({
    class: { $in: students.map((student) => student.class?._id).filter(Boolean) }
  }).select('_id class');
  students.forEach((student) => {
    if (student.subjects === undefined)
      student.subjects = subjects
        .filter((subject) => String(subject.class) === String(student.class?._id))
        .map((subject) => subject._id);
    student.recordVersion = student.recordVersion || 0;
  });
  return { students, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}
async function saveStudent(actor, studentId, body) {
  const input = {
    lrn: P.text(body?.lrn, 'LRN', 30),
    firstName: P.text(body?.firstName, 'first name'),
    lastName: P.text(body?.lastName, 'last name'),
    middleName: P.text(body?.middleName, 'middle name', 100, true),
    gradeLevel: P.text(body?.gradeLevel, 'grade level', 40),
    class: P.id(body?.classId, 'class')
  };
  if (!/^\d+$/.test(input.lrn)) P.fail('LRN must contain digits only.');
  if (!['Male', 'Female'].includes(body.gender)) P.fail('Select a gender.');
  input.gender = body.gender;
  if (!Array.isArray(body.subjectIds)) P.fail('Select the student’s subjects.');
  input.subjects = [...new Set(body.subjectIds.map((value) => P.id(value, 'subject')))];
  if (studentId) P.id(studentId, 'student');
  let savedId;
  await mongoose.connection.transaction(async (session) => {
    await adviser(actor, session);
    const cls = await Class.findById(input.class).session(session);
    if (!cls) P.fail('Class not found.', 404);
    // Serialize enrollment with an admin clearing this section.
    await Class.updateOne({ _id: cls._id }, { $inc: { __v: 1 } }, { session });
    if (cls.gradeLevel && cls.gradeLevel !== input.gradeLevel)
      P.fail('Grade level must match the selected class.');
    let student = studentId ? await Student.findById(studentId).session(session) : null;
    if (studentId && !student) P.fail('Student not found.', 404);
    if (student) P.version(body.version, student.recordVersion);
    if (
      await Student.exists({
        lrn: input.lrn,
        ...(studentId ? { _id: { $ne: studentId } } : {})
      }).session(session)
    )
      P.fail('A student with this LRN already exists.', 409);
    const selected = await Subject.find({
      _id: { $in: input.subjects },
      class: input.class
    }).session(session);
    if (selected.length !== input.subjects.length)
      P.fail('Select subjects belonging to the selected class and section.');
    const oldSubjects = !student
      ? []
      : student.subjects === undefined
        ? (await Subject.find({ class: student.class }).session(session)).map((subject) =>
            String(subject._id)
          )
        : student.subjects.map(String);
    const changed = [...new Set([...oldSubjects, ...input.subjects])].filter(
      (value) => oldSubjects.includes(value) !== input.subjects.includes(value)
    );
    const affected = await Subject.find({ _id: { $in: changed } }).session(session);
    for (const subject of affected) {
      if (subject.gradeStatus === 'finalized')
        P.fail(
          'Enrollment for ' +
            subject.name +
            ' is locked. Its subject teacher must request reopening before changing this placement.',
          409
        );
      await touch(subject, session);
    }
    const before = student?.toObject() || null;
    if (!student) student = new Student(input);
    else Object.assign(student, input);
    student.middleInitial = input.middleName ? input.middleName[0] : '';
    student.updatedBy = actor.userId;
    student.recordVersion = (student.recordVersion || 0) + 1;
    await student.save({ session });
    savedId = student._id;
    await audit(
      actor,
      studentId ? 'student-updated' : 'student-registered',
      { student: student._id, details: { before, after: student.toObject() } },
      session
    );
  });
  return {
    message: studentId ? 'Student record and enrollment updated.' : 'Student registered.',
    studentId: savedId
  };
}
async function monitor(actor) {
  const classes = await adviser(actor);
  const classIds = classes.map((cls) => cls._id);
  const subjects = await Subject.find({ class: { $in: classIds } }).populate('teacher', 'username');
  const students = await Student.find({ class: { $in: classIds } }).sort({
    lastName: 1,
    firstName: 1
  });
  const grades = await Grade.find({
    subject: { $in: subjects.map((s) => s._id) },
    student: { $in: students.map((s) => s._id) }
  });
  const lookup = new Map(
    grades.map((grade) => [
      String(grade.student) + ':' + String(grade.subject),
      P.weightedGrade(grade.scores)
    ])
  );
  const subjectSummaries = subjects.map((subject) => {
    const enrolledStudents = students.filter((student) => P.enrolled(student, subject));
    return {
      _id: subject._id,
      name: subject.name,
      className: classes.find((cls) => String(cls._id) === String(subject.class))?.name,
      teacherName: subject.teacher?.username || 'Not assigned',
      status: subject.gradeStatus || 'draft',
      total: enrolledStudents.length,
      complete: enrolledStudents.filter(
        (student) => lookup.get(String(student._id) + ':' + String(subject._id)) != null
      ).length
    };
  });
  const studentSummaries = students.map((student) => {
    const entries = subjects
      .filter((subject) => P.enrolled(student, subject))
      .map((subject) => ({
        subjectId: subject._id,
        name: subject.name,
        grade: lookup.get(String(student._id) + ':' + String(subject._id)) ?? null,
        status: subject.gradeStatus || 'draft'
      }));
    return {
      studentId: student._id,
      lrn: student.lrn || '',
      name: student.lastName + ', ' + student.firstName,
      className: classes.find((cls) => String(cls._id) === String(student.class))?.name,
      subjects: entries,
      readyForReport:
        entries.length > 0 &&
        entries.every((entry) => entry.grade !== null && entry.status === 'finalized')
    };
  });
  return {
    classes,
    subjects: subjectSummaries,
    students: studentSummaries,
    pendingRequests: await EditRequest.countDocuments({
      class: { $in: classIds },
      status: 'pending'
    })
  };
}
async function finalReport(actor, studentId) {
  // Read one snapshot so a concurrent reopening cannot mix draft scores into a final report.
  return mongoose.connection.transaction(
    async (session) => {
      const classes = await adviser(actor, session);
      const student = await Student.findOne({
        _id: P.id(studentId, 'student'),
        class: { $in: classes.map((cls) => cls._id) }
      })
        .session(session)
        .lean();
      if (!student) P.fail('This student is not in your advisory class.', 403);
      const cls = classes.find((item) => String(item._id) === String(student.class));
      const subjects = await Subject.find({ class: student.class }).session(session);
      const included = subjects.filter((subject) => P.enrolled(student, subject));
      if (!included.length)
        P.fail('Enroll this student in subjects before generating a final report.', 409);
      const grades = await Grade.find({
        student: student._id,
        subject: { $in: included.map((subject) => subject._id) }
      }).session(session);
      const entries = included.map((subject) => ({
        name: subject.name,
        grade: P.weightedGrade(
          grades.find((grade) => String(grade.subject) === String(subject._id))?.scores
        ),
        status: subject.gradeStatus || 'draft'
      }));
      if (entries.some((entry) => entry.status !== 'finalized' || entry.grade === null))
        P.fail(
          'Final reports are available only when every enrolled subject is complete and finalized.',
          409
        );
      const user = await User.findById(actor.userId).select('username').session(session);
      return {
        student,
        className: cls.name,
        section: cls.section || cls.name,
        adviserName: user.username,
        subjects: entries,
        generalAverage: Number(
          (entries.reduce((sum, entry) => sum + entry.grade, 0) / entries.length).toFixed(1)
        ),
        generatedAt: new Date()
      };
    },
    { readConcern: { level: 'snapshot' } }
  );
}
async function insights(actor, subjectId) {
  const data = await teacherRoster(actor, subjectId);
  const distribution = { A: 0, B: 0, C: 0, F: 0, notGraded: 0 };
  const atRisk = [];
  data.roster.forEach((row) => {
    const grade = row.weightedGrade;
    distribution[
      grade === null ? 'notGraded' : grade >= 90 ? 'A' : grade >= 80 ? 'B' : grade >= 75 ? 'C' : 'F'
    ]++;
    if (grade !== null && grade < 75)
      atRisk.push({
        studentId: row.studentId,
        name: row.firstName + ' ' + row.lastName,
        weightedGrade: grade
      });
  });
  const componentAverages = Object.fromEntries(
    P.scoreFields.map((field) => {
      const values = data.roster.map((row) => row.scores[field]).filter((value) => value !== null);
      return [
        field,
        values.length
          ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1))
          : null
      ];
    })
  );
  return {
    ...data,
    distribution,
    componentAverages,
    atRisk: atRisk.sort((a, b) => a.weightedGrade - b.weightedGrade)
  };
}
module.exports = {
  adviser,
  teacherRoster,
  mySubjects,
  saveActivityScores,
  addActivity,
  changeActivity,
  saveGrades,
  finalize,
  requestEdit,
  requestsForAdviser,
  reviewRequest,
  studentOptions,
  listStudents,
  saveStudent,
  monitor,
  finalReport,
  insights,
  myRequests,
  modificationHistory,
  teacherModificationHistory
};
