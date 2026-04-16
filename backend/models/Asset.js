const mongoose = require('mongoose');

const AssetSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  name: String,
  category: String,
  purchaseDate: Date,
  purchaseCost: Number,
  usefulLifeYears: Number,
  residualValue: { type: Number, default: 0 },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Asset', AssetSchema);