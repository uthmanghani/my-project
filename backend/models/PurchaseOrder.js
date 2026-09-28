const mongoose = require('mongoose');

const POLineSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  description: String,
  quantity: Number,
  rate: Number,
  amount: Number
}, { _id: false });

const PurchaseOrderSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  number: {
    type: String,
    required: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  date: { type: Date, required: true },
  expectedDate: Date,
  lines: [POLineSchema],
  total: Number,
  notes: String,
  // 'open' can still be edited/deleted/converted; once converted or
  // cancelled it's a permanent record, same pattern as a voided bill.
  status: {
    type: String,
    enum: ['open', 'converted', 'cancelled'],
    default: 'open'
  },
  // Maker-checker, same pattern as Bill.approvalStatus: a non-admin's PO
  // above the company's approval threshold is held here until an admin
  // signs off — it can still be viewed/edited, but not converted to a
  // bill or sent to the vendor until approved.
  approvalStatus: {
    type: String,
    enum: ['approved', 'pending_approval', 'rejected'],
    default: 'approved'
  },
  convertedBillId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', default: null },
  convertedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

// Purchase order numbers only need to be unique within a company.
PurchaseOrderSchema.index({ companyId: 1, number: 1 }, { unique: true });

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);
