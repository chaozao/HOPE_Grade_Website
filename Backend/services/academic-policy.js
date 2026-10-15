const scoreFields = ['hw1', 'quiz1', 'midterm', 'project1'];
function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function id(value, label = 'record') {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail('Select a valid ' + label + '.');
  return value.toLowerCase();
}
function text(value, label, max = 100, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.trim().length > max) fail('Enter a valid ' + label + '.');
  return value.trim();
}
function version(value, current) {
  if (!Number.isInteger(value) || value < 0) fail('Reload this page before saving.');
  if (value !== (current || 0)) fail('This record changed in another session. Reload before saving.', 409);
}
function weightedGrade(scores = {}) {
  if (scoreFields.some(field => scores[field] == null)) return null;
  return Number(((scores.hw1 * .15 + scores.quiz1 * .20 + scores.midterm * .30 + scores.project1 * .15) / .80).toFixed(1));
}
function rosterFilter(subject) {
  return { $or: [{ subjects: subject._id }, { subjects: { $exists: false }, class: subject.class?._id || subject.class }] };
}
function enrolled(student, subject) {
  return student.subjects === undefined
    ? String(student.class?._id || student.class) === String(subject.class?._id || subject.class)
    : student.subjects.some(value => String(value?._id || value) === String(subject._id));
}
function validateGrades(entries, studentIds) {
  if (!Array.isArray(entries) || !entries.length) fail('No student grades were supplied.');
  const allowed = new Set(studentIds.map(String));
  const seen = new Set();
  return entries.map(entry => {
    const studentId = id(entry?.studentId, 'student');
    if (!allowed.has(studentId)) fail('A student is not enrolled in this subject.', 403);
    if (seen.has(studentId)) fail('A student was submitted more than once.');
    seen.add(studentId);
    if (!entry.scores || typeof entry.scores !== 'object') fail('Enter valid assessment scores.');
    const scores = {};
    scoreFields.forEach(field => {
      const value = entry.scores[field];
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) fail('Scores must be numbers from 0 to 100, or blank.');
      scores[field] = value;
    });
    return { studentId, scores };
  });
}
function validateActivityScores(entries, studentIds, activities, term) {
  if (![1, 2, 3].includes(term)) fail('Select a valid term.');
  if (!Array.isArray(entries) || !entries.length) fail('No activity scores were supplied.');
  const allowed = new Set(studentIds.map(String));
  const columns = new Map(activities.filter(item => item.term === term).map(item => [String(item._id), item]));
  const seen = new Set();
  return entries.map(entry => {
    const studentId = id(entry?.studentId, 'student');
    if (!allowed.has(studentId)) fail('A student is not enrolled in this subject.', 403);
    if (seen.has(studentId)) fail('A student was submitted more than once.');
    seen.add(studentId);
    if (!entry.scores || typeof entry.scores !== 'object' || Array.isArray(entry.scores) || !Object.keys(entry.scores).length) fail('Enter activity scores.');
    const scores = {};
    for (const [key, value] of Object.entries(entry.scores)) {
      const activity = columns.get(key);
      if (!activity) fail('This activity is unavailable in the selected term. Reload the class.', 409);
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > activity.maxScore)) fail(activity.title + ': enter a score from 0 to ' + activity.maxScore + ', or leave it blank.');
      scores[key] = value;
    }
    return { studentId, scores };
  });
}
function requireDraft(subject) {
  if (subject.gradeStatus === 'finalized') fail('These grades are finalized and locked. Request reopening from the class adviser.', 409);
}
function requireComplete(roster) {
  if (!roster.length) fail('Enroll students before finalizing grades.');
  if (roster.some(row => weightedGrade(row.scores) === null)) fail('Complete every enrolled student’s scores before finalizing.', 409);
}
module.exports = { validateActivityScores, fail, id, text, version, scoreFields, weightedGrade, rosterFilter, enrolled, validateGrades, requireDraft, requireComplete };
