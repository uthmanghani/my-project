const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  code: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'],
    required: true
  },
  balance: {
    type: Number,
    default: 0
  },
  openingBalance: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // IFRS 18 presentation overrides. null = classify automatically from the name.
  ifrs18Category: { type: String, enum: ['operating', 'investing', 'financing', 'income_tax', 'discontinued', null], default: null },
  ifrs18Line: { type: String, enum: ['revenue', 'other_operating_income', 'cost_of_sales', 'selling_distribution', 'administrative', 'other_operating', null], default: null },
  bsClass: { type: String, enum: ['current', 'non_current', null], default: null }
});

AccountSchema.index({ companyId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('Account', AccountSchema);