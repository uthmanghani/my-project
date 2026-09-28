const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  type: { type: String, default: '' },
  // Same base64 data: URI validation as Invoice/Bill — without it, a
  // stored value could later be handed straight to viewAttachment()'s
  // <a href>/<img src>, so anything other than an embedded data URI is
  // rejected here rather than trusted from the client.
  data: {
    type: String,
    default: '',
    validate: {
      validator: v => !v || /^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(v),
      message: 'attachment.data must be a base64 data: URI'
    }
  }
}, { _id: false });

const QuoteLineSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  description: String,
  quantity: Number,
  rate: Number,
  amount: Number,
  vatApplicable: { type: Boolean, default: true },
  vatRate: Number,
  lineVat: Number
}, { _id: false });

const QuoteSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  number: { type: String, required: true },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  date: { type: Date, required: true },
  // "Valid until" — the frontend also uses this to auto-expire a quote
  // that's sitting unanswered, the same way an overdue invoice is flagged.
  expiryDate: { type: Date, required: true },
  lines: [QuoteLineSchema],
  subtotal: Number,
  vat: Number,
  total: Number,
  notes: String,
  attachment: { type: AttachmentSchema, default: undefined },

  // No journal entry, stock movement, or account balance is ever posted
  // for a quote — it has zero accounting impact until convertToInvoice()
  // runs invoiceController.create on its behalf. That keeps this whole
  // model financially inert by construction: nothing here needs reversing
  // if a quote is edited, declined, or deleted.
  status: {
    type: String,
    enum: ['draft', 'sent', 'accepted', 'declined', 'expired', 'converted'],
    default: 'draft'
  },

  convertedInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
  convertedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now }
});

// Quote numbers only need to be unique within a company — same reasoning
// as Invoice/Bill/PO numbering elsewhere in this codebase.
QuoteSchema.index({ companyId: 1, number: 1 }, { unique: true });

module.exports = mongoose.model('Quote', QuoteSchema);
