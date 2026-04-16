const Vendor = require('../models/Vendor');

// Get all vendors
exports.getAll = async (req, res) => {
  try {
    const vendors = await Vendor.find({ companyId: req.user.companyId })
      .sort({ name: 1 });
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get a single vendor
exports.getOne = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Create a new vendor
exports.create = async (req, res) => {
  try {
    const { name, email, phone, address, tin, openingBalance } = req.body;
    const vendor = new Vendor({
      companyId: req.user.companyId,
      name,
      email,
      phone,
      address,
      tin,
      openingBalance: openingBalance || 0
    });
    await vendor.save();
    res.status(201).json(vendor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update a vendor
exports.update = async (req, res) => {
  try {
    const vendor = await Vendor.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete a vendor
exports.delete = async (req, res) => {
  try {
    const vendor = await Vendor.findOneAndDelete({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ message: 'Vendor deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};