const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true       // e.g. "Grade 10 - Diamond"
  },
  adviser: {
    type: mongoose.Schema.Types.ObjectId,  // points to a User
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

const Class = mongoose.model('Class', classSchema);

module.exports = Class;