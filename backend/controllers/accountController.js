const Account = require('../models/Account');

exports.getAll = async (req, res) => {
  try {
    const accounts = await Account.find({ companyId: req.user.companyId }).sort({ code: 1 });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { code, name, type, openingBalance } = req.body;
    const existing = await Account.findOne({ companyId: req.user.companyId, code });
    if (existing) return res.status(400).json({ error: 'Account code already exists' });
    const account = new Account({
      companyId: req.user.companyId,
      code,
      name,
      type,
      openingBalance: openingBalance || 0,
      balance: openingBalance || 0
    });
    await account.save();
    res.status(201).json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateOpeningBalance = async (req, res) => {
  try {
    const { code, openingBalance } = req.body;
    const account = await Account.findOne({ companyId: req.user.companyId, code });
    if (!account) return res.status(404).json({ error: 'Account not found' });
    account.openingBalance = openingBalance;
    account.balance = openingBalance; // simplified; in real system you'd recalc from journals
    await account.save();
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const account = await Account.findOneAndDelete({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({ message: 'Account deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};