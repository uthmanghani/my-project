const mongoose = require('mongoose');

const BankTransactionSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  // Links this transaction to a specific BankAccount document — needed so
  // the frontend can filter/group transactions and compute per-account
  // balances. bankAccountCode (below) is a separate concept: the chart-of-
  // accounts code used for the journal entry, not the specific account.
  bankId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
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