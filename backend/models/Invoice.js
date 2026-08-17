const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  date: Date,
  amount: Number,
  recordedAt: { type: Date, default: Date.now }
});

const InvoiceLineSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  description: String,
  quantity: Number,
  rate: Number,
  amount: Number,
  vatApplicable: { type: Boolean, default: true },
  vatRate: Number,
  lineVat: Number
});

const InvoiceSchema = new mongoose.Schema({
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
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  lines: [InvoiceLineSchema],
  subtotal: Number,
  vat: Number,
  total: Number,
  status: {
    type: String,
    enum: ['unpaid', 'partial', 'paid', 'overdue', 'voided'],
    default: 'unpaid'
  },
  payments: [PaymentSchema],
  amountPaid: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  notes: String,
  isRecurring: { type: Boolean, default: false },
  recurringFreq: { type: String, enum: ['monthly', 'weekly', 'quarterly', 'annually'] },
  recurringNextDate: Date,
  recurringEndDate: Date,
  createdAt: { type: Date, default: Date.now },

  // FIRS/NRS e-invoicing readiness — populated once an Access Point
  // Provider integration validates the invoice. Safe to leave null until then.
  einvoiceStatus: {
    type: String,
    enum: ['not_required', 'pending', 'validated', 'rejected'],
    default: 'not_required'
  },
  irn: { type: String, default: null },      // Invoice Reference Number
  csid: { type: String, default: null },      // Cryptographic Stamp ID
  qrCode: { type: String, default: null },    // QR payload/URL
  einvoiceSubmittedAt: { type: Date, default: null },
  einvoiceValidatedAt: { type: Date, default: null },

  // A posted invoice is never deleted — voiding reverses its journal
  // entries (revenue, VAT, COGS) instead, keeping the original traceable.
  voided: { type: Boolean, default: false },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  voidReason: { type: String, default: null }
});

InvoiceSchema.pre('save', function(next) {
  if (this.voided) { this.status = 'voided'; return next(); }
  this.balance = this.total - this.amountPaid;
  if (this.balance <= 0.005) this.status = 'paid';
  else if (this.amountPaid > 0.005) this.status = 'partial';
  else this.status = 'unpaid';
  next();
});

module.exports = mongoose.model('Invoice', InvoiceSchema);