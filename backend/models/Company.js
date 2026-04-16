const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  legalName: String,
  rcNumber: String,
  tin: String,
  phone: String,
  email: String,
  address: String,
  industry: {
    type: String,
    required: true
  },
  settings: {
    invoicePrefix: { type: String, default: 'INV-' },
    nextInvoiceNumber: { type: Number, default: 1 },
    defaultDueDays: { type: Number, default: 30 },
    defaultVatRate: { type: Number, default: 7.5 },
    defaultInvoiceNotes: { type: String, default: 'Thank you for your business.' },
    darkMode: { type: Boolean, default: false },
    currency: { type: String, default: '₦' }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Company', CompanySchema);