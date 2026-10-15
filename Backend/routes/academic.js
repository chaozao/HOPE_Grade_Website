const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');
const service = require('../services/academic');
const Student = require('../models/Student');
const Subject = require('../models/Subject');
const router = express.Router();
router.use(['/adviser', '/teacher'], verifyToken, requireRole('teacher'));
function route(handler) {
  return async (req, res) => {
    try { res.json(await handler(req)); }
    catch (error) {
      const duplicate = error.code === 11000;
      res.status(error.status || (duplicate ? 409 : 500)).json({ error: duplicate
        ? 'This LRN or pending request already exists. Reload before trying again.'
        : error.status ? error.message : 'Could not complete this request. Please reload and try again.' });
    }
  };
}
router.get('/adviser/my-class', route(async req => {
  // Preserve the existing 404 contract used by teacher/adviser login routing.
  const classes = await service.adviser(req.user).catch(error => {
    if (error.status === 403) { error.status = 404; }
    throw error;
  });
  const cls = classes[0];
  return { class: cls, students: await Student.find({ class: cls._id }).sort({ lastName: 1, firstName: 1 }),
    subjects: await Subject.find({ class: cls._id }).populate('teacher', 'username email') };
}));
router.get('/adviser/student-options', route(req => service.studentOptions(req.user)));
router.get('/adviser/students', route(req => service.listStudents(req.user, req.query)));
router.post('/adviser/students', route(req => service.saveStudent(req.user, null, req.body)));
router.put('/adviser/students/:id', route(req => service.saveStudent(req.user, req.params.id, req.body)));
router.get('/adviser/monitor', route(req => service.monitor(req.user)));
router.get('/adviser/edit-requests', route(req => service.requestsForAdviser(req.user)));
router.get('/adviser/modification-history', route(req => service.modificationHistory(req.user)));
router.get('/teacher/modification-history', route(req => service.teacherModificationHistory(req.user)));
router.get('/teacher/edit-requests', route(req => service.myRequests(req.user)));
router.post('/adviser/edit-requests/:id/review', route(req => service.reviewRequest(req.user, req.params.id, req.body)));
router.get('/adviser/students/:id/final-report', route(req => service.finalReport(req.user, req.params.id)));
router.get('/teacher/my-subjects', route(req => service.mySubjects(req.user)));
router.get('/teacher/subjects/:id/roster', route(req => service.teacherRoster(req.user, req.params.id)));
router.post('/teacher/subjects/:id/activities', route(req => service.addActivity(req.user, req.params.id, req.body)));
router.put('/teacher/subjects/:id/activities/:activityId', route(req => service.changeActivity(req.user, req.params.id, req.params.activityId, req.body)));
router.delete('/teacher/subjects/:id/activities/:activityId', route(req => service.changeActivity(req.user, req.params.id, req.params.activityId, req.body, true)));
router.get('/teacher/subjects/:id/summary', route(req => service.teacherRoster(req.user, req.params.id)));
router.get('/teacher/subjects/:id/insights', route(req => service.insights(req.user, req.params.id)));
router.put('/teacher/subjects/:id/activity-scores', route(req => service.saveActivityScores(req.user, req.params.id, req.body)));
router.put('/teacher/subjects/:id/grades', route(req => service.saveGrades(req.user, req.params.id, req.body)));
router.post('/teacher/subjects/:id/finalize', route(req => service.finalize(req.user, req.params.id, req.body)));
router.post('/teacher/subjects/:id/edit-requests', route(req => service.requestEdit(req.user, req.params.id, req.body)));
module.exports = router;
