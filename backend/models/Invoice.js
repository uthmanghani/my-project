const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  type: { type: String, default: '' },
  // Must be an embedded data: URI, e.g. "data:image/png;base64,....". This is
  // the ONLY field validated here, but it's the one that matters: without
  // this check, anything (including a javascript: URI) could be stored and
  // later handed straight to a real <a href> click or <img src> by the
  // frontend's viewAttachment() -- a stored-XSS vector that happened not to
  // fire only because this field was silently dropped (not in either
  // schema) before now, so nothing was ever actually persisted to trigger it.
  data: {
    type: String,
    default: '',
    validate: {
      validator: v => !v || /^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(v),
      message: 'attachment.data must be a base64 data: URI'
    }
  }
}, { _id: false });

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
    required: true
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
  attachment: { type: AttachmentSchema, default: undefined },
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

// Invoice numbers only need to be unique WITHIN a company — every company
// legitimately starts its own numbering at INV-0001. A bare unique:true on
// 'number' alone (the previous approach) enforced uniqueness across every
// tenant in the database, guaranteeing a collision the moment any two
// companies' invoice numbers ever matched — which they always will, since
// every new company starts at the same default.
InvoiceSchema.index({ companyId: 1, number: 1 }, { unique: true });

module.exports = mongoose.model('Invoice', InvoiceSchema);