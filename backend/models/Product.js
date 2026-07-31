const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  sku: String,
  category: String,
  unit: String,
  // Raw materials are bought and consumed into production — they're never
  // sold directly, so they shouldn't need a sale price at all. Finished
  // goods keep both price and cost required, exactly as before.
  itemType: {
    type: String,
    enum: ['finished_good', 'raw_material'],
    default: 'finished_good'
  },
  price: {
    type: Number,
    required: function() { return this.itemType !== 'raw_material'; }
  },
  cost: {
    type: Number,
    required: true
  },
  stock: {
    type: Number,
    default: 0
  },
  reorderLevel: {
    type: Number,
    default: 5
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Product', ProductSchema);