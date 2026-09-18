const mongoose = require('mongoose');

const gradeSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true
  },
  scores: {
    hw1: { type: Number, min: 0, max: 100, default: null },
    quiz1: { type: Number, min: 0, max: 100, default: null },
    midterm: { type: Number, min: 0, max: 100, default: null },
    project1: { type: Number, min: 0, max: 100, default: null }
  }
}, {
  timestamps: true
});

// A student can only have ONE grade record per subject - no duplicates
gradeSchema.index({ student: 1, subject: 1 }, { unique: true });

const Grade = mongoose.model('Grade', gradeSchema);

module.exports = Grade;