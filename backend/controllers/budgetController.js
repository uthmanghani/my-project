const Budget = require('../models/Budget');
const { logAudit } = require('../utils/auditLog');
const AppError = require('../utils/AppError');

exports.getAll = async (req, res) => {
  try {
    const budgets = await Budget.find({ companyId: req.user.companyId, isActive: { $ne: false } });
    res.json(budgets);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};