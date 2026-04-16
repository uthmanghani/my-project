const mongoose = require('mongoose');

const BankAccountSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  name: String,
  bank: String,
  accountNumber: String,
  openingBalance: { type: Number, default: 0 },
  code: { type: String, default: '1000' },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('BankAccount', BankAccountSchema);