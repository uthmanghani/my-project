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
    enum: ['invoice', 'bill', 'payment', 'payroll', 'journal', 'depreciation', 'bank', 'drawings', 'cogs', 'credit_note', 'closing'],
    default: 'journal'
  },
  referenceType: {
    type: String,
    enum: ['invoice', 'bill', 'payment', 'payroll', null]
  },
  referenceId: mongoose.Schema.Types.ObjectId,
  lines: [JournalLineSchema],
  // A posted journal entry is never deleted — corrections go through a
  // controlled reversal instead, so the original stays fully traceable.
  voided: { type: Boolean, default: false },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  voidReason: { type: String, default: null },
  // On the ORIGINAL entry: points to the reversing entry that voided it.
  reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  // On the REVERSING entry itself: points back to what it reverses.
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('JournalEntry', JournalEntrySchema);