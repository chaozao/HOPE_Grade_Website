const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
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
    required: true
  }
}, {
  timestamps: true
});

const Subject = mongoose.model('Subject', subjectSchema);

module.exports = Subject;