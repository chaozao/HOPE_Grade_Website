const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  lrn: { type: String, trim: true, match: /^\d{1,30}$/ },
  middleName: { type: String, trim: true, maxlength: 100, default: '' },
  gradeLevel: { type: String, trim: true, maxlength: 40, default: '' },
  // Missing on legacy records means all subjects in the existing class.
  // An explicit empty array means not yet enrolled in any subject.
  subjects: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }], default: undefined },
  recordVersion: { type: Number, default: 0 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastName: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    required: true
  },
  middleInitial: {
    type: String,
    maxlength: 3
  },
  gender: {
    type: String,
    enum: ['Male', 'Female'],
    required: true
  },
  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  }
}, {
  timestamps: true
});

studentSchema.index({ lrn: 1 }, { unique: true, partialFilterExpression: { lrn: { $type: 'string' } } });

const Student = mongoose.model('Student', studentSchema);

module.exports = Student;
