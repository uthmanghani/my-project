const Customer = require('../models/Customer');
const { logAudit } = require('../utils/auditLog');

exports.getAll = async (req, res) => {
  try {
    const customers = await Customer.find({ companyId: req.user.companyId, isActive: { $ne: false } }).sort({ name: 1 });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const customer = await Customer.findOne({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const customer = new Customer({ ...req.body, companyId: req.user.companyId });
    await customer.save();
    res.status(201).json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const customer = await Customer.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows provided' });
    const docs = rows.map(r => ({ ...r, companyId: req.user.companyId }));
    await Customer.insertMany(docs, { ordered: false });
    res.json({ message: `${docs.length} customers imported` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
 
exports.delete = async (req, res) => {
  try {
    const customer = await Customer.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      { isActive: false },
      { new: true }
    );
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    await logAudit(req, 'CUSTOMER_DEACTIVATED', `Deactivated customer ${customer.name}`);
    res.json({ message: 'Customer deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};