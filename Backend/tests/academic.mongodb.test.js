// Opt-in integration test. Uses a newly created, uniquely named database only.
// PowerShell: $env:HOPE_RUN_MONGO_TESTS='1'; node --test Backend/tests/academic.mongodb.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User'),
  Class = require('../models/Class'),
  Subject = require('../models/Subject');
const Student = require('../models/Student'),
  Grade = require('../models/Grade');
const Request = require('../models/GradeEditRequest'),
  Audit = require('../models/AcademicAudit');

test(
  'real MongoDB academic workflow, permissions, locks, approval and reporting',
  { skip: process.env.HOPE_RUN_MONGO_TESTS !== '1', timeout: 120000 },
  async (t) => {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
    const dbName = 'hope_wf_test_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    await mongoose.connect(process.env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 10000 });
    t.after(async () => {
      assert.match(dbName, /^hope_wf_test_\d+_[a-f0-9]+$/);
      assert.equal(mongoose.connection.name, dbName);
      try {
        // The application database account can remove records but cannot drop databases.
        await Promise.all(
          [User, Class, Subject, Student, Grade, Request, Audit].map((model) =>
            model.deleteMany({})
          )
        );
      } finally {
        await mongoose.disconnect();
      }
    });
    await Promise.all(
      [User, Class, Subject, Student, Grade, Request, Audit].map((model) => model.init())
    );
    const users = await User.create(
      ['adviser', 'other-adviser', 'teacher', 'other-teacher'].map((name) => ({
        username: name,
        email: name + '@fixture.invalid',
        password: 'unused-test-password',
        role: 'teacher'
      }))
    );
    const [adviser, otherAdviser, teacher, otherTeacher] = users;
    const classes = await Class.create([
      { name: 'Grade 7 - A', gradeLevel: 'Grade 7', section: 'A', adviser: adviser._id },
      { name: 'Grade 10 - B', gradeLevel: 'Grade 10', section: 'B', adviser: otherAdviser._id }
    ]);
    const [cls, otherClass] = classes;
    const [math, science, otherSubject] = await Subject.create([
      { name: 'Math', class: cls._id, teacher: teacher._id },
      { name: 'Science', class: cls._id, teacher: teacher._id },
      { name: 'History', class: otherClass._id, teacher: otherTeacher._id }
    ]);
    const app = express();
    app.use(express.json());
    app.use(require('../routes/academic'));
    app.use('/admin/clear-data', require('../routes/clear-data'));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    async function call(user, method, url, body, expected = 200, role = 'teacher') {
      const token = jwt.sign(
        { userId: String(user._id), role, username: user.username },
        process.env.JWT_SECRET
      );
      const response = await fetch(base + url, {
        method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const data = await response.json();
      assert.equal(response.status, expected, method + ' ' + url + ': ' + JSON.stringify(data));
      return data;
    }
    const input = {
      lrn: '000000000001',
      firstName: 'Ana',
      lastName: 'Santos',
      middleName: 'Reyes',
      gender: 'Female',
      gradeLevel: 'Grade 7',
      classId: String(cls._id),
      subjectIds: [String(math._id)]
    };
    let studentId, version, requestId;
    const mathPath = '/teacher/subjects/' + math._id;
    await t.test(
      'subject teachers cannot register students, browse the global registry or approve requests',
      async () => {
        await call(teacher, 'POST', '/adviser/students', input, 403);
        await call(teacher, 'GET', '/adviser/students', null, 403);
        await call(teacher, 'GET', '/adviser/monitor', null, 403);
        await call(teacher, 'GET', '/adviser/student-options', null, 403);
        await call(adviser, 'GET', '/adviser/students', null, 403, 'admin');
      }
    );
    await t.test(
      'adviser registers and edits students across grade levels with unique LRN',
      async () => {
        studentId = (await call(adviser, 'POST', '/adviser/students', input)).studentId;
        await call(adviser, 'POST', '/adviser/students', input, 409);
        const other = await call(adviser, 'POST', '/adviser/students', {
          ...input,
          lrn: '000000000002',
          gradeLevel: 'Grade 10',
          classId: String(otherClass._id),
          subjectIds: [String(otherSubject._id)]
        });
        const list = await call(adviser, 'GET', '/adviser/students');
        assert.equal(list.total, 2);
        assert.equal((await Student.findById(studentId)).lrn, '000000000001');
        await call(adviser, 'PUT', '/adviser/students/' + studentId, {
          ...input,
          middleName: 'Updated',
          version: 1
        });
        await call(adviser, 'PUT', '/adviser/students/' + studentId, { ...input, version: 1 }, 409);
        await call(
          adviser,
          'GET',
          '/adviser/students/' + other.studentId + '/final-report',
          null,
          403
        );
        await call(
          adviser,
          'POST',
          '/adviser/students',
          { ...input, lrn: '000000000003', subjectIds: [String(otherSubject._id)] },
          400
        );
      }
    );
    await t.test(
      'only assigned subjects and explicitly enrolled students are visible',
      async () => {
        const roster = await call(teacher, 'GET', mathPath + '/roster');
        assert.equal(roster.totalStudents, 1);
        version = roster.gradeVersion;
        assert.equal(
          (await call(teacher, 'GET', '/teacher/subjects/' + science._id + '/roster'))
            .totalStudents,
          0
        );
        await call(otherTeacher, 'GET', mathPath + '/roster', null, 403);
        await call(adviser, 'PUT', mathPath + '/grades', { version, grades: [] }, 403);
        const subjectIds = (await call(teacher, 'GET', '/teacher/my-subjects')).map(
          (subject) => subject._id
        );
        assert.deepEqual(subjectIds.sort(), [String(math._id), String(science._id)].sort());
        await call(
          teacher,
          'PUT',
          mathPath + '/grades',
          {
            version,
            grades: [
              {
                studentId: String(new mongoose.Types.ObjectId()),
                scores: { hw1: 85, quiz1: 85, midterm: 85, project1: 85 }
              }
            ]
          },
          403
        );
      }
    );
    await t.test(
      'incomplete grades cannot finalize; complete grades save and lock atomically',
      async () => {
        await call(teacher, 'POST', mathPath + '/finalize', { version }, 409);
        await call(adviser, 'GET', '/adviser/students/' + studentId + '/final-report', null, 409);
        const saved = await call(teacher, 'PUT', mathPath + '/grades', {
          version,
          grades: [{ studentId, scores: { hw1: 85, quiz1: 85, midterm: 85, project1: 85 } }]
        });
        version = saved.gradeVersion;
        await call(teacher, 'POST', mathPath + '/finalize', { version });
        const locked = await call(teacher, 'GET', mathPath + '/roster');
        assert.equal(locked.gradeStatus, 'finalized');
        version = locked.gradeVersion;
        await call(
          teacher,
          'PUT',
          mathPath + '/grades',
          {
            version,
            grades: [{ studentId, scores: { hw1: 99, quiz1: 99, midterm: 99, project1: 99 } }]
          },
          409
        );
        await call(
          adviser,
          'PUT',
          '/adviser/students/' + studentId,
          { ...input, subjectIds: [], version: 2 },
          409
        );
        assert.equal(
          (await Grade.findOne({ student: studentId, subject: math._id })).scores.hw1,
          85
        );
        const report = await call(
          adviser,
          'GET',
          '/adviser/students/' + studentId + '/final-report'
        );
        assert.equal(report.generalAverage, 85);
        assert.equal((await call(teacher, 'GET', mathPath + '/summary')).gradeStatus, 'finalized');
      }
    );
    await t.test(
      'only the subject class adviser receives and approves reopening; rejection keeps locks',
      async () => {
        await call(teacher, 'POST', mathPath + '/edit-requests', {
          version,
          reason: 'Correct HW 1'
        });
        await call(
          teacher,
          'POST',
          mathPath + '/edit-requests',
          { version, reason: 'Duplicate' },
          409
        );
        const requests = await call(adviser, 'GET', '/adviser/edit-requests');
        requestId = requests[0]._id;
        assert.equal((await call(otherAdviser, 'GET', '/adviser/edit-requests')).length, 0);
        await call(
          otherAdviser,
          'POST',
          '/adviser/edit-requests/' + requestId + '/review',
          { decision: 'approved' },
          403
        );
        await call(
          teacher,
          'POST',
          '/adviser/edit-requests/' + requestId + '/review',
          { decision: 'approved' },
          403
        );
        await call(adviser, 'POST', '/adviser/edit-requests/' + requestId + '/review', {
          decision: 'rejected',
          note: 'Please explain the correction.'
        });
        assert.equal((await Subject.findById(math._id)).gradeStatus, 'finalized');
        await call(teacher, 'POST', mathPath + '/edit-requests', {
          version,
          reason: 'HW 1 should be 90 instead of 85.'
        });
        requestId = String((await Request.findOne({ status: 'pending' }))._id);
        await call(adviser, 'POST', '/adviser/edit-requests/' + requestId + '/review', {
          decision: 'approved',
          note: 'Verified correction.'
        });
        await call(
          adviser,
          'POST',
          '/adviser/edit-requests/' + requestId + '/review',
          { decision: 'approved' },
          409
        );
        await call(adviser, 'GET', '/adviser/students/' + studentId + '/final-report', null, 409);
        const reopened = await call(teacher, 'GET', mathPath + '/roster');
        assert.equal(reopened.gradeStatus, 'draft');
        version = reopened.gradeVersion;
      }
    );
    await t.test('corrections are saved, finalized again, monitored and audited', async () => {
      const result = await call(teacher, 'PUT', mathPath + '/grades', {
        version,
        grades: [{ studentId, scores: { hw1: 90, quiz1: 85, midterm: 85, project1: 85 } }]
      });
      version = result.gradeVersion;
      await call(teacher, 'POST', mathPath + '/finalize', { version });
      const report = await call(adviser, 'GET', '/adviser/students/' + studentId + '/final-report');
      assert.equal(report.generalAverage, 85.9);
      const monitoring = await call(adviser, 'GET', '/adviser/monitor');
      assert.equal(monitoring.students.length, 1);
      assert.equal(monitoring.students[0].readyForReport, true);
      assert.ok((await Audit.countDocuments({ action: 'grades-finalized' })) >= 2);
      assert.equal(await Audit.countDocuments({ action: 'reopening-approved' }), 1);
      const ownRequests = await call(teacher, 'GET', '/teacher/edit-requests');
      assert.equal(ownRequests.length, 2);
      assert.equal(ownRequests[0].subject.name, 'Math');
      assert.equal((await call(otherTeacher, 'GET', '/teacher/edit-requests')).length, 0);
      const history = await call(adviser, 'GET', '/adviser/modification-history');
      assert.ok(history.some((entry) => entry.action === 'reopening-approved'));
      assert.ok(history.every((entry) => !entry.details && entry.subject.name === 'Math'));
      assert.equal((await call(otherAdviser, 'GET', '/adviser/modification-history')).length, 0);
      await call(teacher, 'GET', '/adviser/modification-history', null, 403);
    });
    await t.test(
      'legacy students keep their existing implicit enrollments and grades',
      async () => {
        await Student.collection.insertOne({
          firstName: 'Legacy',
          lastName: 'Student',
          gender: 'Male',
          class: otherClass._id
        });
        assert.equal(
          (await call(otherTeacher, 'GET', '/teacher/subjects/' + otherSubject._id + '/roster'))
            .totalStudents,
          2
        );
        const result = await call(adviser, 'GET', '/adviser/students?q=Legacy');
        assert.equal(result.students[0].subjects.length, 1);
      }
    );
    const admin = await User.create({
      username: 'admin',
      email: 'admin@fixture.invalid',
      password: 'unused',
      role: 'admin'
    });
    const clearBody = (ids) => ({ ids: ids.map(String), confirmation: 'CLEAR' });
    await t.test(
      'clear data requires an active admin, valid selection and explicit confirmation',
      async () => {
        await call(teacher, 'POST', '/admin/clear-data/subjects', clearBody([math._id]), 403);
        await call(
          teacher,
          'POST',
          '/admin/clear-data/subjects',
          clearBody([math._id]),
          403,
          'admin'
        );
        await call(
          admin,
          'POST',
          '/admin/clear-data/subjects',
          { ids: [String(math._id)] },
          400,
          'admin'
        );
        await call(admin, 'POST', '/admin/clear-data/classes', clearBody([]), 400, 'admin');
        await call(
          admin,
          'POST',
          '/admin/clear-data/subjects',
          clearBody([math._id, new mongoose.Types.ObjectId()]),
          409,
          'admin'
        );
        assert.ok(await Subject.exists({ _id: math._id }));
      }
    );
    await t.test('a failed cascade rolls back all deletions', async (t) => {
      t.mock.method(Grade, 'deleteMany', async () => {
        throw new Error('Simulated database failure');
      });
      await call(admin, 'POST', '/admin/clear-data/subjects', clearBody([math._id]), 500, 'admin');
      assert.ok(await Subject.exists({ _id: math._id }));
      assert.ok(await Grade.exists({ subject: math._id }));
    });
    await t.test(
      'clearing a finalized subject removes linked data and keeps other subjects and students',
      async () => {
        await call(
          admin,
          'POST',
          '/admin/clear-data/subjects',
          clearBody([math._id]),
          200,
          'admin'
        );
        for (const model of [Grade, Request, Audit])
          assert.equal(await model.countDocuments({ subject: math._id }), 0);
        assert.equal(await Subject.countDocuments({ _id: math._id }), 0);
        assert.ok(await Class.exists({ _id: cls._id }));
        assert.ok(await Subject.exists({ _id: science._id }));
        const student = await Student.findById(studentId);
        assert.ok(student);
        assert.equal(
          student.subjects.some((id) => String(id) === String(math._id)),
          false
        );
        await call(teacher, 'GET', mathPath + '/roster', null, 404);
        assert.equal(
          (await call(teacher, 'GET', '/teacher/my-subjects')).some(
            (item) => item._id === String(math._id)
          ),
          false
        );
        assert.deepEqual((await User.findById(teacher._id)).teacherRoles, ['subject-teacher']);
      }
    );
    await t.test(
      'clearing a class cascades across adviser and teacher data without affecting another class',
      async () => {
        await call(admin, 'POST', '/admin/clear-data/classes', clearBody([cls._id]), 200, 'admin');
        assert.equal(await Class.countDocuments({ _id: cls._id }), 0);
        assert.equal(await Subject.countDocuments({ class: cls._id }), 0);
        assert.equal(await Student.countDocuments({ class: cls._id }), 0);
        assert.equal(await Audit.countDocuments({ student: studentId }), 0);
        assert.equal((await call(teacher, 'GET', '/teacher/my-subjects')).length, 0);
        assert.deepEqual((await User.findById(teacher._id)).teacherRoles, []);
        assert.deepEqual((await User.findById(adviser._id)).teacherRoles, []);
        assert.ok(await Class.exists({ _id: otherClass._id }));
        assert.ok(await Subject.exists({ _id: otherSubject._id }));
        assert.equal(await Student.countDocuments({ class: otherClass._id }), 2);
        assert.ok(await User.exists({ _id: teacher._id }));
      }
    );
  }
);
