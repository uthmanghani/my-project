const mongoose = require('mongoose');

const RecurringBillingSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  name: { type: String, required: true },
  type: {
    type: String,
    enum: ['invoice', 'bill'],
    required: true
  },
  // References a Customer when type is 'invoice', a Vendor when type is
  // 'bill'. Deliberately not a ref'd ObjectId to one collection since it
  // legitimately points at either, depending on type.
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
  amount: { type: Number, required: true },
  description: { type: String, default: '' },
  frequency: {
    type: String,
    enum: ['weekly', 'monthly', 'quarterly', 'yearly'],
    required: true
  },
  nextDate: { type: Date, required: true },
  endDate: { type: Date, default: null },
  active: { type: Boolean, default: true },
  // Expense account to post generated BILLS to. Only used when type is
  // 'bill' -- an invoice's revenue account comes from company defaults,
  // the same as any other invoice.
  expenseAccount: { type: String, default: '6000' },
  lastRunAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RecurringBilling', RecurringBillingSchema);
