const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
  gradeStatus: { type: String, enum: ['draft', 'finalized'], default: 'draft' },
  gradeVersion: { type: Number, default: 0 },
  workflowRevision: { type: Number, default: 0 },
  finalizedAt: { type: Date, default: null },
  finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name: {
    type: String,
    required: true        // e.g. "Algebra II"
  },
  class: {
    type: mongoose.Schema.Types.ObjectId,  // which class takes this subject
    ref: 'Class',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,  // which teacher handles it
    ref: 'User',
    default: null // a subject can wait for a teacher assignment
  }
}, {
  timestamps: true
});

const Subject = mongoose.model('Subject', subjectSchema);

module.exports = Subject;
