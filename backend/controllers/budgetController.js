const Budget = require('../models/Budget');

exports.getAll = async (req, res) => {
  try {
    const budgets = await Budget.find({ companyId: req.user.companyId });
    res.json(budgets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { accountCode, year, amount } = req.body;
    let budget = await Budget.findOne({ companyId: req.user.companyId, accountCode, year });
    if (budget) {
      budget.amount = amount;
      await budget.save();
    } else {
      budget = new Budget({ companyId: req.user.companyId, accountCode, year, amount });
      await budget.save();
    }
    res.status(201).json(budget);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const budget = await Budget.findOneAndDelete({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    res.json({ message: 'Budget deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};