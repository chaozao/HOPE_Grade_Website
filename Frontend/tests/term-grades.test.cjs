const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculate, transpose, descriptor } = require('../js/term-grades');
const { examinationPS } = require('../js/term-grades');

test('examination weights above or below 100 normalize independently in all three terms', () => {
  const activities = [], scores = {};
  for (const [term, weights] of [[1, [30,30,30,40,40]], [2, [20,20]], [3, [5,15,30]]]) {
    for (const category of ['writtenOral', 'performanceTasks']) {
      const id = term + category;
      activities.push({ _id: id, term, category, maxScore: 100 });
      scores[id] = 100;
    }
    weights.forEach((weight, index) => {
      const id = term + 'exam' + index;
      activities.push({ _id: id, term, category: 'examination', maxScore: 50, wsPercentage: weight });
      scores[id] = 50;
    });
  }
  for (const term of [1,2,3]) {
    assert.deepEqual(calculate(activities, scores, term), { initialGrade: 100, termGrade: 100, descriptor: 'Advancing' });
    const exams = activities.filter((item) => item.term === term && item.category === 'examination');
    assert.equal(examinationPS(exams, exams.map((item) => item.wsPercentage / 2)), 50);
  }
  scores['1exam0'] = 0;
  assert.equal(calculate(activities, scores, 1).initialGrade, 96.47);
  assert.equal(calculate(activities, scores, 2).initialGrade, 100);
  const exams = activities.filter((item) => item.term === 1 && item.category === 'examination');
  assert.equal(examinationPS(exams, [null,30,30,40,40]), null);
});

test('all supplied transmutation intervals include both boundaries', () => {
  const intervals = [
    [0,4.67],[4.68,9.34],[9.35,14],[14.01,18.67],[18.68,23.34],
    [23.35,28],[28.01,32.67],[32.68,37.33],[37.34,42],[42.01,46.66],
    [46.67,51.33],[51.34,56],[56.01,60.66],[60.67,65.33],[65.34,69.99],
    [70,71.17],[71.18,72.35],[72.36,73.53],[73.54,74.71],[74.72,75.89],
    [75.9,77.07],[77.08,78.25],[78.26,79.43],[79.44,80.61],[80.62,81.79],
    [81.8,82.97],[82.98,84.15],[84.16,85.33],[85.34,86.51],[86.52,87.69],
    [87.7,88.87],[88.88,90.05],[90.06,91.23],[91.24,92.41],[92.42,93.59],
    [93.6,94.77],[94.78,95.95],[95.96,97.13],[97.14,98.31],[98.32,99.49],[99.5,100]
  ];
  intervals.forEach(([low, high], index) => {
    assert.equal(transpose(low), 60 + index, String(low));
    assert.equal(transpose(high), 60 + index, String(high));
  });
  assert.equal(transpose(69.994), 74);
  assert.equal(transpose(69.996), 75);
  for (const invalid of [null, undefined, NaN, Infinity, -1, 101, '75'])
    assert.equal(transpose(invalid), null);
});

test('descriptor boundaries use the transmuted grade', () => {
  for (const [low, high, label] of [[60,64,'Emerging'],[65,74,'Developing'],[75,79,'Connecting'],[80,89,'Benchmarking'],[90,100,'Advancing']]) {
    assert.equal(descriptor(low), label);
    assert.equal(descriptor(high), label);
  }
});

test('initial grades sum weighted categories and require complete valid scores in each term', () => {
  const activities = [
    { _id: 'w', term: 1, category: 'writtenOral', maxScore: 50 },
    { _id: 'p', term: 1, category: 'performanceTasks', maxScore: 100 },
    { _id: 'e1', term: 1, category: 'examination', maxScore: 50, wsPercentage: 40 },
    { _id: 'e2', term: 1, category: 'examination', maxScore: 100, wsPercentage: 60 }
  ];
  assert.deepEqual(calculate(activities, { w: 35, p: 70, e1: 35, e2: 70 }, 1), { initialGrade: 70, termGrade: 75, descriptor: 'Connecting' });
  assert.deepEqual(calculate(activities, { w: 0, p: 0, e1: 0, e2: 0 }, 1), { initialGrade: 0, termGrade: 60, descriptor: 'Emerging' });
  assert.equal(calculate(activities, { w: 50, p: 100, e1: 50, e2: 100 }, 1).termGrade, 100);
  for (const e2 of [undefined, null, '', -1, 101, NaN])
    assert.equal(calculate(activities, { w: 35, p: 70, e1: 35, e2 }, 1).termGrade, null);
  assert.equal(calculate(activities, { w: 35, p: 70, e1: 35, e2: 70 }, 2).termGrade, null);
  delete activities[2].wsPercentage;
  assert.equal(calculate(activities, { w: 35, p: 70, e1: 35, e2: 70 }, 1).termGrade, null);
});
