const Attendance = require('../models/Attendance');
const Narrative = require('../models/NarrativeReport');
const Values = require('../models/CoreValueReport');
const dailyAttendance = require('./daily-attendance');
const catalog = require('../../Frontend/js/core-values');

async function source(studentIds, subjectIds, session = null) {
  const filter = { student: { $in: studentIds }, subject: { $in: subjectIds } };
  const [attendance, narratives, values] = await Promise.all([
    Attendance.find({ subject: { $in: subjectIds } }).session(session), Narrative.find(filter).session(session),
    Values.find(filter).session(session)
  ]);
  return { attendance, narratives, values };
}
function monthlySummary(student, subject, records) {
  const days = new Map();
  for (const record of records) {
    if (String(record.subject) !== String(subject._id) || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) continue;
    if (!days.has(record.date)) days.set(record.date, []);
    if (String(record.student) === String(student._id)) days.get(record.date).push(record.status);
  }
  const years = [...new Set([...days.keys()].map((date) => Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 6 ? 1 : 0)))].sort();
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = [];
  for (const year of years) {
    // June?April by default; include May if attendance was actually recorded then.
    const order = [6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4];
    if ([...days.keys()].some((date) => date.startsWith((year + 1) + '-05-'))) order.push(5);
    for (const month of order) {
      const calendarYear = year + (month < 6 ? 1 : 0);
      const key = calendarYear + '-' + String(month).padStart(2, '0');
      const summary = { label: labels[month - 1] + (years.length > 1 ? ' ' + calendarYear : ''), key, schoolDays: 0, present: 0, absent: 0, tardy: 0 };
      for (const [date, statuses] of days) {
        if (!date.startsWith(key + '-')) continue;
        summary.schoolDays++;
        if (statuses.some((status) => status === 'present' || status === 'tardy')) summary.present++;
        if (statuses.includes('tardy')) summary.tardy++;
        if (!statuses.some((status) => status === 'present' || status === 'tardy') && statuses.length && statuses.every((status) => status === 'absent')) summary.absent++;
      }
      months.push(summary);
    }
  }
  return months;
}
function build(student, subjects, data) {
  data = { ...data, attendance: dailyAttendance(data.attendance) };
  const missing = [], attendance = [], narratives = [], values = [];
  const belongs = (record, subject) => String(record.student) === String(student._id) && String(record.subject) === String(subject._id);
  for (const subject of subjects) {
    const records = data.attendance.filter((item) => belongs(item, subject));
    const sessions = new Set(data.attendance.filter((item) => String(item.subject) === String(subject._id)).map((item) => item.date));
    const missingDates = [...sessions].filter((date) => !records.some((record) => record.date === date && record.status !== 'unmarked'));
    if (!records.length || missingDates.length) missing.push(subject.name + ': attendance is incomplete. ' + (missingDates.length ? 'Mark and save: ' + missingDates.sort().join(', ') + '.' : 'Record and save attendance by date.'));
    for (let term = 1; term <= 3; term++) {
      const narrative = data.narratives.find((item) => belongs(item, subject) && item.term === term);
      narratives.push({ subjectId: String(subject._id), subject: subject.name, term, canDo: narrative?.canDo || '', improving: narrative?.improving || '' });
      if (!narrative?.canDo?.trim() || !narrative?.improving?.trim()) missing.push(subject.name + ', term ' + term + ': narrative report is incomplete.');
      for (const category of ['filipino', 'personal']) {
        const report = data.values.find((item) => belongs(item, subject) && item.term === term && item.category === category);
        const ratings = report?.ratings instanceof Map ? Object.fromEntries(report.ratings) : report?.ratings || {};
        values.push({ subjectId: String(subject._id), subject: subject.name, term, category, ratings });
        if (catalog[category].items.some(([id]) => !['AO', 'SO', 'RO', 'NO'].includes(ratings[id]))) missing.push(subject.name + ', term ' + term + ': ' + catalog[category].label + ' is incomplete.');
      }
    }
  }
  return { attendance, monthlyAttendance: subjects.map((subject) => ({ subjectId: String(subject._id), subject: subject.name, months: monthlySummary(student, subject, data.attendance) })), attendanceNote: 'Each subject is counted separately using its recorded attendance dates, not an official school calendar. Each date counts once within that subject. Tardy days are included in Present and also shown separately.', narratives, values, missing: [...new Set(missing)] };
}
module.exports = { source, build };
