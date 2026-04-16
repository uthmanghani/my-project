const mongoose = require('mongoose');

const BankTransactionSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  bankAccountCode: String,
  date: Date,
  type: { type: String, enum: ['debit', 'credit'] },
  amount: Number,
  description: String,
  reference: String,
  reconciled: { type: Boolean, default: false },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('BankTransaction', BankTransactionSchema);