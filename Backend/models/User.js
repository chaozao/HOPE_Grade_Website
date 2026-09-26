const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
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
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'teacher'],
    default: 'teacher'
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
}, {
  timestamps: true
});

const User = mongoose.model('User', userSchema);

module.exports = User;