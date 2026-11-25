// Shared by the browser and backend so saved scores and live previews agree.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TermGrades = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  // Inclusive upper limits in hundredths. The grade is 60 + the matching index.
  // Grade 77 covers 72.36–73.53, following the supplied transmutation table.
  const limits = [467, 934, 1400, 1867, 2334, 2800, 3267, 3733, 4200, 4666,
    5133, 5600, 6066, 6533, 6999, 7117, 7235, 7353, 7471, 7589, 7707, 7825,
    7943, 8061, 8179, 8297, 8415, 8533, 8651, 8769, 8887, 9005, 9123, 9241,
    9359, 9477, 9595, 9713, 9831, 9949, 10000];
  const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  function transpose(initial) {
    if (!Number.isFinite(initial) || initial < 0 || initial > 100) return null;
    const index = limits.findIndex((limit) => Math.round(round(initial) * 100) <= limit);
    return index < 0 ? null : 60 + index;
  }
  function descriptor(grade) {
    if (!Number.isFinite(grade) || grade < 60 || grade > 100) return 'Not graded';
    if (grade < 65) return 'Emerging';
    if (grade < 75) return 'Developing';
    if (grade < 80) return 'Connecting';
    if (grade < 90) return 'Benchmarking';
    return 'Advancing';
  }
  function calculate(activities, scores, term) {
    const weighted = {};
    for (const [category, weight] of [['writtenOral', 20], ['performanceTasks', 60], ['examination', 20]]) {
      const items = activities.filter((activity) => activity.term === term && activity.category === category);
      const complete = items.length > 0 && items.every((activity) => {
        const score = scores[String(activity._id)];
        return Number.isFinite(score) && score >= 0 && score <= activity.maxScore &&
          Number.isFinite(activity.maxScore) && activity.maxScore > 0 &&
          (category !== 'examination' || (Number.isFinite(activity.wsPercentage) && activity.wsPercentage > 0 && activity.wsPercentage <= 100));
      });
      if (!complete) return { initialGrade: null, termGrade: null, descriptor: 'Not graded' };
      const ps = category === 'examination'
        ? examinationPS(items, items.map((activity) => scores[String(activity._id)] / activity.maxScore * activity.wsPercentage))
        : items.reduce((sum, activity) => sum + scores[String(activity._id)], 0) /
          items.reduce((sum, activity) => sum + activity.maxScore, 0) * 100;
      weighted[category] = round(ps * weight / 100);
    }
    // Sum the category WS values displayed to two decimals.
    const initialGrade = round(Object.values(weighted).reduce((sum, value) => sum + value, 0));
    const termGrade = transpose(initialGrade);
    return { initialGrade, termGrade, descriptor: descriptor(termGrade) };
  }
  function examinationPS(activities, contributions) {
    if (!activities.length || activities.length !== contributions.length ||
        activities.some((activity) => !Number.isFinite(activity.wsPercentage) || activity.wsPercentage <= 0 || activity.wsPercentage > 100) ||
        contributions.some((value) => !Number.isFinite(value))) return null;
    const totalWeight = activities.reduce((sum, activity) => sum + activity.wsPercentage, 0);
    return contributions.reduce((sum, value) => sum + value, 0) / totalWeight * 100;
  }
  return { calculate, transpose, descriptor, examinationPS };
});
