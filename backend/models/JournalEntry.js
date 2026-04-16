const mongoose = require('mongoose');

const JournalLineSchema = new mongoose.Schema({
  accountCode: String,
  amount: Number,
  type: { type: String, enum: ['debit', 'credit'] }
});

const JournalEntrySchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  date: Date,
  description: String,
  type: {
    type: String,
    enum: ['invoice', 'bill', 'payment', 'payroll', 'journal', 'depreciation', 'bank', 'drawings'],
    default: 'journal'
  },
  referenceType: {
    type: String,
    enum: ['invoice', 'bill', 'payment', 'payroll', null]
  },
  referenceId: mongoose.Schema.Types.ObjectId,
  lines: [JournalLineSchema],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('JournalEntry', JournalEntrySchema);