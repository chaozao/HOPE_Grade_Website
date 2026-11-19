const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  date: { type: String, required: true },
  term: { type: Number, enum: [1, 2, 3] },
  status: { type: String, enum: ['unmarked', 'absent', 'present', 'tardy'], required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ subject: 1, student: 1, date: 1, term: 1 }, { unique: true });
// Replace only the obsolete index; preserve every existing attendance record.
let termIndexReady;
schema.statics.ensureTermIndex = function () {
  if (!termIndexReady) termIndexReady = (async () => {
    await this.collection.createIndex({ subject: 1, student: 1, date: 1, term: 1 }, { unique: true });
    const indexes = await this.collection.indexes();
    for (const index of indexes) {
      if (index.unique && Object.keys(index.key).length === 3 &&
          index.key.subject === 1 && index.key.student === 1 && index.key.date === 1) {
        try { await this.collection.dropIndex(index.name); }
        catch (error) { if (error.code !== 27) throw error; }
      }
    }
  })().catch((error) => { termIndexReady = null; throw error; });
  return termIndexReady;
};
module.exports = mongoose.model('Attendance', schema);
