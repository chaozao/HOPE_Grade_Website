const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      unique: true
    },
    password: {
      type: String,
      required: true,
      select: false // hidden from every query by default - a route must explicitly ask for it with .select('+password')
    },
    role: {
      type: String,
      enum: ['admin', 'teacher'],
      default: 'teacher'
    },
    // Keep the account role used by authentication separate from teaching duties.
    teacherRoles: {
      type: [{ type: String, enum: ['class-advisor', 'subject-teacher'] }],
      default: []
    },
    isActive: {
      type: Boolean,
      default: true
    },
    photo: {
      type: String,
      default: null
    },
    resetTokenHash: {
      type: String,
      default: null
    },
    resetTokenExpiry: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

const User = mongoose.model('User', userSchema);

module.exports = User;
