const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  email: String,
  phone: String,
  address: String,
  tin: String,
  openingBalance: {
    type: Number,
    default: 0
  },
  // Soft-delete: deactivating instead of removing preserves referential
  // integrity for every invoice/payment that already references this
  // customer, and keeps historical reports accurate.
  isActive: { type: Boolean, default: true },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Customer', CustomerSchema);