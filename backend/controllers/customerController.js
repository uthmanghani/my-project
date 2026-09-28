const Customer = require('../models/Customer');
const { logAudit } = require('../utils/auditLog');
const AppError = require('../utils/AppError');

exports.getAll = async (req, res) => {
  try {
    const customers = await Customer.find({ companyId: req.user.companyId, isActive: { $ne: false } }).sort({ name: 1 });
    res.json(customers);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.create = async (req, res) => {
  try {
    const customer = new Customer({ ...req.body, companyId: req.user.companyId });
    await customer.save();
    res.status(201).json(customer);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};