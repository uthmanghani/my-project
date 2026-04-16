const Payment = require('../models/Payment');

exports.getCustomerPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ companyId: req.user.companyId, type: 'customer' })
      .populate('entityId', 'name')
      .populate('invoiceId', 'number')
      .sort({ date: -1 });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
};