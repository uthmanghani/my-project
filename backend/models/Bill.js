const mongoose = require('mongoose');

const BillPaymentSchema = new mongoose.Schema({
  date: Date,
  amount: Number,
  recordedAt: { type: Date, default: Date.now }
});

const BillLineSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  description: String,
  quantity: Number,
  rate: Number,
  amount: Number
});

const BillSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  number: {
    type: String,
    required: true,
    unique: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  date: Date,
  dueDate: Date,
  lines: [BillLineSchema],
  total: Number,
  whtRate: Number,
  whtAmount: Number,
  netPayable: Number,
  status: {
    type: String,
    enum: ['unpaid', 'partial', 'paid', 'overdue', 'voided'],
    default: 'unpaid'
  },
  payments: [BillPaymentSchema],
  amountPaid: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  expenseAccount: String,
  isInventoryPurchase: { type: Boolean, default: false },
  // Maker-checker approval workflow — this field was referenced by
  // billController.js but never actually existed in this schema, meaning
  // it was silently stripped on every save. Adding it for real.
  approvalStatus: {
    type: String,
    enum: ['approved', 'pending_approval'],
    default: 'approved'
  },
  // A posted bill is never deleted — voiding reverses its journal entries
  // and stock impact instead, keeping the original fully traceable.
  voided: { type: Boolean, default: false },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  voidReason: { type: String, default: null },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

BillSchema.pre('save', function(next) {
  if (this.voided) { this.status = 'voided'; return next(); }
  this.balance = this.total - this.amountPaid;
  if (this.balance <= 0.005) this.status = 'paid';
  else if (this.amountPaid > 0.005) this.status = 'partial';
  else this.status = 'unpaid';
  next();
});

module.exports = mongoose.model('Bill', BillSchema);