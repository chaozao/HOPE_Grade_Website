const mongoose = require('mongoose');

const classSchema = new mongoose.Schema(
  {
    gradeLevel: { type: String, trim: true, maxlength: 40, default: '' },
    section: { type: String, trim: true, maxlength: 100, default: '' },
    name: {
      type: String,
      required: true // e.g. "Grade 10 - Diamond"
    },
    adviser: {
      type: mongoose.Schema.Types.ObjectId, // points to a User
      ref: 'User',
      default: null // a class can wait for an advisor assignment
    }
  },
  {
    timestamps: true
  }
);

const Class = mongoose.model('Class', classSchema);

module.exports = Class;
