const mongoose = require('mongoose');

// Single-document cache — there's only ever one "current" set of rates
// per deployment, so we always read/write the same _id.
const ExchangeRateCacheSchema = new mongoose.Schema({
  _id: { type: String, default: 'singleton' },
  // Units of NGN per 1 unit of foreign currency, e.g. { USD: 1580.23, GBP: 2010.50 }
  rates: { type: Object, required: true },
  fetchedAt: { type: Date, required: true }
});

module.exports = mongoose.model('ExchangeRateCache', ExchangeRateCacheSchema);
