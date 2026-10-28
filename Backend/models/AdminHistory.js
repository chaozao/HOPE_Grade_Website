const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: { type: String, required: true },
  action: { type: String, required: true },
  reversible: { type: Boolean, default: true },
  changes: [{
    _id: false,
    model: { type: String, enum: ['User', 'Class', 'Subject'], required: true },
    target: { type: mongoose.Schema.Types.ObjectId, required: true },
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed
  }],
  undoneAt: Date
}, { timestamps: true });
schema.index({ createdAt: -1, _id: -1 });
schema.index({ 'changes.target': 1, _id: -1 });
module.exports = mongoose.model('AdminHistory', schema);
