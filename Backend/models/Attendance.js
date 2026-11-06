const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  date: { type: String, required: true },
  status: { type: String, enum: ['unmarked', 'absent', 'present', 'tardy'], required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ subject: 1, student: 1, date: 1 }, { unique: true });
module.exports = mongoose.model('Attendance', schema);
