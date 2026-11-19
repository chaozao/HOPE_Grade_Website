const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  term: { type: Number, enum: [1, 2, 3], required: true },
  category: { type: String, enum: ['filipino', 'personal'], required: true },
  ratings: { type: Map, of: String, default: {} },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ subject: 1, student: 1, term: 1, category: 1 }, { unique: true });
module.exports = mongoose.model('CoreValueReport', schema);
