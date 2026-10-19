const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    request: { type: mongoose.Schema.Types.ObjectId, ref: 'GradeEditRequest' },
    details: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);
module.exports = mongoose.model('AcademicAudit', schema);
