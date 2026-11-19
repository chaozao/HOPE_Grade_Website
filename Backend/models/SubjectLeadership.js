const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  head: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deadline: { type: Date, default: null },
  revision: { type: Number, default: 0 }
}, { timestamps: true });
module.exports = mongoose.model('SubjectLeadership', schema);
