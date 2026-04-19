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
    enum: ['unpaid', 'partial', 'paid', 'overdue'],
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
  isRecurring: { type: Boolean, default: false },
  recurringFrequency: { type: String, enum: ['weekly','monthly','quarterly'], default: 'monthly' },
  recurringNextDate: { type: Date },
  recurringEndDate: { type: Date }

});

InvoiceSchema.pre('save', function(next) {
  this.balance = this.total - this.amountPaid;
  if (this.balance <= 0.005) this.status = 'paid';
  else if (this.amountPaid > 0.005) this.status = 'partial';
  else this.status = 'unpaid';
  next();
});

module.exports = mongoose.model('Invoice', InvoiceSchema);