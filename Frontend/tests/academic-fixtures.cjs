// Stateful API fixture for the browser-only academic workflow test.
module.exports = function academicFixture() {
  const state = {
    student: null,
    version: 0,
    status: 'draft',
    requests: [],
    scores: { hw1: null, quiz1: null, midterm: null, project1: null }
  };
  const cls = { _id: 'class1', name: 'Grade 7 - A', gradeLevel: 'Grade 7', section: 'A' };
  function grade() {
    return Object.values(state.scores).some((value) => value === null)
      ? null
      : Number(
          (
            (state.scores.hw1 * 0.15 +
              state.scores.quiz1 * 0.2 +
              state.scores.midterm * 0.3 +
              state.scores.project1 * 0.15) /
            0.8
          ).toFixed(1)
        );
  }
  function roster() {
    return {
      subjectId: 'math',
      subjectName: 'Math',
      className: cls.name,
      adviserName: 'Test Advisor',
      canRequestEdit: true,
      gradeStatus: state.status,
      gradeVersion: state.version,
      requests: state.requests,
      totalStudents: state.student ? 1 : 0,
      classAverage: grade(),
      passingRate: grade() === null ? null : 100,
      roster: state.student
        ? [
            {
              ...state.student,
              studentId: 'student1',
              scores: state.scores,
              weightedGrade: grade()
            }
          ]
        : []
    };
  }
  return function handle(req, url, json) {
    const route = url.pathname.slice(4);
    const mutate = (work) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => work(JSON.parse(body)));
    };
    if (route === '/adviser/student-options') {
      json({
        classes: [cls],
        subjects: [
          {
            _id: 'math',
            name: 'Math',
            class: 'class1',
            teacher: { username: 'Test Teacher' },
            gradeStatus: state.status
          }
        ]
      });
      return true;
    }
    if (route === '/adviser/students' && req.method === 'GET') {
      json({
        students: state.student ? [state.student] : [],
        page: 1,
        pages: 1,
        total: state.student ? 1 : 0
      });
      return true;
    }
    if (route === '/adviser/students' && req.method === 'POST') {
      mutate((body) => {
        state.student = {
          ...body,
          _id: 'student1',
          class: cls,
          subjects: body.subjectIds,
          recordVersion: 1
        };
        state.version++;
        json({ message: 'Student registered.', studentId: 'student1' });
      });
      return true;
    }
    if (route === '/adviser/students/student1' && req.method === 'PUT') {
      mutate((body) => {
        state.student = {
          ...state.student,
          ...body,
          class: cls,
          subjects: body.subjectIds,
          recordVersion: 2
        };
        json({ message: 'Student updated.' });
      });
      return true;
    }
    if (route === '/teacher/my-subjects') {
      json([
        { _id: 'math', name: 'Math', className: cls.name, studentCount: state.student ? 1 : 0 }
      ]);
      return true;
    }
    if (route === '/teacher/subjects/math/roster' || route === '/teacher/subjects/math/summary') {
      json(roster());
      return true;
    }
    if (route === '/teacher/subjects/math/grades') {
      mutate((body) => {
        if (state.status === 'finalized') return json({ error: 'Grades are locked.' }, 409);
        state.scores = body.grades[0].scores;
        state.version++;
        json({ message: 'Grades saved.', gradeVersion: state.version });
      });
      return true;
    }
    if (route === '/teacher/subjects/math/finalize') {
      mutate(() => {
        state.status = 'finalized';
        state.version++;
        json({ message: 'Grades finalized and locked.' });
      });
      return true;
    }
    if (route === '/teacher/subjects/math/edit-requests') {
      mutate((body) => {
        state.requests.unshift({
          _id: 'request1',
          subject: { _id: 'math', name: 'Math' },
          class: cls,
          requestedBy: { username: 'Test Teacher' },
          reason: body.reason,
          status: 'pending',
          createdAt: new Date().toISOString()
        });
        json({ message: 'Request sent to the class adviser.' });
      });
      return true;
    }
    if (route === '/adviser/modification-history') {
      json(
        state.requests
          .filter((r) => r.status === 'approved')
          .map((r) => ({
            action: 'reopening-approved',
            subject: r.subject,
            actor: { username: 'Test Advisor' },
            createdAt: r.createdAt
          }))
      );
      return true;
    }
    if (route === '/teacher/edit-requests') {
      json(state.requests);
      return true;
    }
    if (route === '/adviser/edit-requests') {
      json(state.requests);
      return true;
    }
    if (route === '/adviser/edit-requests/request1/review') {
      mutate((body) => {
        state.requests[0].status = body.decision;
        state.requests[0].reviewNote = body.note;
        if (body.decision === 'approved') {
          state.status = 'draft';
          state.version++;
        }
        json({ message: 'Request reviewed.' });
      });
      return true;
    }
    if (route === '/adviser/monitor') {
      json({
        classes: [cls],
        subjects: [
          {
            _id: 'math',
            name: 'Math',
            className: cls.name,
            teacherName: 'Test Teacher',
            total: 1,
            complete: grade() === null ? 0 : 1,
            status: state.status
          }
        ],
        students: state.student
          ? [
              {
                studentId: 'student1',
                lrn: state.student.lrn,
                name: state.student.lastName + ', ' + state.student.firstName,
                className: cls.name,
                subjects: [
                  { subjectId: 'math', name: 'Math', grade: grade(), status: state.status }
                ],
                readyForReport: grade() !== null && state.status === 'finalized'
              }
            ]
          : [],
        pendingRequests: state.requests.filter((r) => r.status === 'pending').length
      });
      return true;
    }
    if (route === '/adviser/students/student1/final-report') {
      json({
        student: state.student,
        className: cls.name,
        adviserName: 'Test Advisor',
        subjects: [{ name: 'Math', grade: grade(), status: state.status }],
        generalAverage: grade(),
        generatedAt: new Date().toISOString()
      });
      return true;
    }
    return false;
  };
};
