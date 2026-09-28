const Payment = require('../models/Payment');
const AppError = require('../utils/AppError');

exports.getCustomerPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ companyId: req.user.companyId, type: 'customer' })
      .populate('entityId', 'name')
      .populate('invoiceId', 'number')
      .sort({ date: -1 });
    res.json(payments);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.getVendorPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ companyId: req.user.companyId, type: 'vendor' })
      .populate('entityId', 'name')
      .populate('billId', 'number')
      .sort({ date: -1 });
    res.json(payments);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};