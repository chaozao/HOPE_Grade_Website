const router = require('express').Router();
const mongoose = require('mongoose');
const { verifyToken } = require('../middleware/auth');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Leadership = require('../models/SubjectLeadership');
const Request = require('../models/GradeEditRequest');
const P = require('../services/academic-policy');
const { key } = require('../services/grading-access');
const academic = require('../services/academic');
router.use(verifyToken);
const route = (handler) => async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user?.isActive || user.role !== req.user.role) P.fail('Your account is unavailable. Sign in again.', 403);
    res.json(await handler(req));
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not update grading settings.' }); }
};
router.get('/', route(async (req) => {
  const subjects = await Subject.find().select('name');
  const policies = await Leadership.find().populate('head', 'username');
  const names = [...new Map(subjects.map((s) => [key(s.name), s.name])).entries()];
  const rows = names.map(([name, label]) => {
    const policy = policies.find((p) => p.name === name);
    return { name, label, head: policy?.head?._id || null, headName: policy?.head?.username || '', deadline: policy?.deadline || null, revision: policy?.revision || 0 };
  }).filter((row) => req.user.role === 'admin' || String(row.head) === req.user.userId);
  return { subjects: rows, teachers: req.user.role === 'admin' ? await User.find({ role: 'teacher', isActive: true }).select('username') : [] };
}));
router.put('/', route(async (req) => {
  const name = key(P.text(req.body?.name, 'subject name'));
  await mongoose.connection.transaction(async (session) => {
    const subjects = await Subject.find().session(session);
    if (!subjects.some((s) => key(s.name) === name)) P.fail('Subject not found.', 404);
    let policy = await Leadership.findOne({ name }).session(session);
    if (req.user.role === 'admin') {
      const head = req.body.head ? P.id(req.body.head, 'subject head') : null;
      if (head && !await User.findOne({ _id: head, role: 'teacher', isActive: true }).session(session)) P.fail('Select an active teacher.');
      policy ||= new Leadership({ name });
      policy.head = head;
      if (!head) policy.deadline = null;
    } else {
      if (req.user.role !== 'teacher' || !policy?.head || String(policy.head) !== req.user.userId)
        P.fail('Only this subject head may set its deadline.', 403);
      const value = req.body.deadline;
      if (value !== null && (typeof value !== 'string' || !/Z$|[+-]\d\d:\d\d$/.test(value) || !Number.isFinite(Date.parse(value))))
        P.fail('Enter a valid deadline including its timezone.');
      policy.deadline = value ? new Date(value) : null;
    }
    policy.revision = (policy.revision || 0) + 1;
    await policy.save({ session });
    const ids = subjects.filter((s) => key(s.name) === name).map((s) => s._id);
    await Request.updateMany({ subject: { $in: ids }, status: 'pending' }, { $set: { status: 'rejected', reviewNote: 'Subject head or deadline changed. Submit a new request if needed.', reviewedBy: req.user.userId, reviewedAt: new Date() } }, { session });
  });
  return { message: 'Grading settings saved.' };
}));
router.get('/requests', route((req) => academic.requestsForAdviser(req.user)));
router.post('/requests/:id/review', route((req) => academic.reviewRequest(req.user, req.params.id, req.body)));
module.exports = router;
