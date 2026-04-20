const mongoose = require('mongoose');
 
const InviteSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  email: { type: String, default: null },
  note: { type: String, default: '' },
  used: { type: Boolean, default: false },
  usedAt: { type: Date },
  usedBy: { type: String },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});
 
module.exports = mongoose.model('Invite', InviteSchema);