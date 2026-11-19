// Legacy term records remain stored. One latest mark per student/subject/date is used.
module.exports = function dailyAttendance(records) {
  const days = new Map();
  for (const record of records) {
    const key = [record.subject, record.student, record.date].map(String).join(':');
    const prior = days.get(key);
    if (!prior || (record.term == null && prior.term != null) ||
        ((record.term == null) === (prior.term == null) && new Date(record.updatedAt || 0) >= new Date(prior.updatedAt || 0))) days.set(key, record);
  }
  return [...days.values()];
};
