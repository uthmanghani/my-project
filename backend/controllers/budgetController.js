const Budget = require('../models/Budget');
const { logAudit } = require('../utils/auditLog');

exports.getAll = async (req, res) => {
  try {
    const budgets = await Budget.find({ companyId: req.user.companyId, isActive: { $ne: false } });
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
    const budget = await Budget.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      { isActive: false },
      { new: true }
    );
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    await logAudit(req, 'BUDGET_DEACTIVATED', `Deactivated budget ${budget.name || budget._id}`);
    res.json({ message: 'Budget deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};