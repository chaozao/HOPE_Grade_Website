const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'current' },
  terms: [{ _id: false, term: { type: Number, enum: [1, 2, 3] }, start: String, end: String }]
}, { timestamps: true });
module.exports = mongoose.model('SchoolTerms', schema);
