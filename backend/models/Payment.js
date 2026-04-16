const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  type: {
    type: String,
    enum: ['customer', 'vendor']
  },
  entityId: mongoose.Schema.Types.ObjectId,
  invoiceId: mongoose.Schema.Types.ObjectId,
  billId: mongoose.Schema.Types.ObjectId,
  amount: Number,
  date: Date,
  bankAccountCode: String,
  reference: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Payment', PaymentSchema);