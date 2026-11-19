const Leadership = require('../models/SubjectLeadership');
const P = require('./academic-policy');
const key = (name) => String(name || '').trim().toLowerCase();
async function access(actor, subject, session = null, lock = false) {
  const policy = await Leadership.findOne({ name: key(subject.name) }).session(session);
  if (lock && policy) await Leadership.updateOne({ _id: policy._id }, { $inc: { __v: 1 } }, { session });
  const isHead = Boolean(policy?.head && String(policy.head) === actor.userId);
  const expired = Boolean(policy?.deadline && Date.now() >= new Date(policy.deadline).getTime());
  const granted = Boolean(subject.editPermission && policy &&
    subject.editPermission.policyRevision === policy.revision &&
    String(subject.editPermission.teacher) === actor.userId);
  return { policy, isHead, expired, granted, canEdit: !expired || isHead || granted,
    canRequest: expired && !isHead && !granted && Boolean(policy?.head) };
}
async function requireEditing(actor, subject, session) {
  const state = await access(actor, subject, session, true);
  if (!state.canEdit) P.fail('The grading deadline has passed. Request approval from your subject head.', 409);
  if (subject.gradeStatus === 'finalized') {
    subject.gradeStatus = 'draft'; subject.finalizedAt = null; subject.finalizedBy = null;
  }
  return state;
}
module.exports = { key, access, requireEditing };
