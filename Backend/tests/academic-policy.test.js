const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../services/academic-policy');
const id = '111111111111111111111111';
test('grades require enrolled students, finite scores, and unique entries', () => {
  const entry = { studentId: id, scores: { hw1: 0, quiz1: 80, midterm: 90, project1: null } };
  assert.equal(P.validateGrades([entry], [id])[0].scores.hw1, 0);
  assert.throws(() => P.validateGrades([entry], []), { status: 403 });
  assert.throws(() => P.validateGrades([entry, entry], [id]));
  for (const score of ['80', NaN, Infinity, -1, 101, undefined])
    assert.throws(() =>
      P.validateGrades([{ ...entry, scores: { ...entry.scores, hw1: score } }], [id])
    );
});
test('finalization requires complete roster; finalized grades and stale versions reject changes', () => {
  assert.throws(() => P.requireComplete([]));
  assert.throws(() => P.requireComplete([{ scores: {} }]));
  P.requireComplete([{ scores: { hw1: 0, quiz1: 0, midterm: 0, project1: 0 } }]);
  assert.throws(() => P.requireDraft({ gradeStatus: 'finalized' }), { status: 409 });
  assert.throws(() => P.version(1, 2), { status: 409 });
  P.version(0, undefined);
  assert.equal(P.weightedGrade({ hw1: 85, quiz1: 85, midterm: 85, project1: 85 }), 85);
});
test('legacy students retain class subjects; explicit empty enrollment does not', () => {
  const subject = { _id: id, class: 'class1' };
  assert.equal(P.enrolled({ class: 'class1' }, subject), true);
  assert.equal(P.enrolled({ class: 'class1', subjects: [] }, subject), false);
  assert.equal(P.enrolled({ class: 'class1', subjects: [id] }, subject), true);
  assert.equal(P.enrolled({ class: 'class2' }, subject), false);
});
