const Account = require('../models/Account');
const { logAudit } = require('../utils/auditLog');
const AppError = require('../utils/AppError');

exports.getAll = async (req, res) => {
  try {
    const accounts = await Account.find({ companyId: req.user.companyId }).sort({ code: 1 });
    res.json(accounts);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.updateOpeningBalance = async (req, res) => {
  try {
    const { code, openingBalance } = req.body;
    const account = await Account.findOne({ companyId: req.user.companyId, code });
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const newOB = Number(openingBalance);
    if (!Number.isFinite(newOB)) return res.status(400).json({ error: 'openingBalance must be a number' });
    // Shift the running balance by the CHANGE in opening balance. Overwriting it
    // would erase every journal movement already posted to the account.
    account.balance = (account.balance || 0) + (newOB - (account.openingBalance || 0));
    account.openingBalance = newOB;
    await account.save();
    res.json(account);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.delete = async (req, res) => {
  try {
    const account = await Account.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (Math.abs(account.balance || 0) > 0.005) {
      return res.status(400).json({
        error: `This account still has a balance of ${account.balance}. Post a journal entry to zero it out before deactivating.`
      });
    }
    account.isActive = false;
    await account.save();
    await logAudit(req, 'ACCOUNT_DEACTIVATED', `Deactivated account ${account.code} — ${account.name}`);
    res.json({ message: 'Account deactivated' });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

const IFRS18_CATEGORIES = ['operating', 'investing', 'financing', 'income_tax', 'discontinued'];
const IFRS18_LINES = ['revenue', 'other_operating_income', 'cost_of_sales', 'selling_distribution', 'administrative', 'other_operating'];

// PUT /api/accounts/:id/classification  { ifrs18Category?, ifrs18Line?, bsClass? }
// Pass null (or '') to clear an override and go back to automatic classification.
exports.updateClassification = async (req, res) => {
  try {
    const account = await Account.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const { ifrs18Category, ifrs18Line, bsClass } = req.body;
    const norm = (v) => (v === '' || v === undefined ? undefined : v);
    if (norm(ifrs18Category) !== undefined) {
      if (ifrs18Category !== null && !IFRS18_CATEGORIES.includes(ifrs18Category)) return res.status(400).json({ error: 'Invalid IFRS 18 category' });
      if (!['Revenue', 'Expense'].includes(account.type)) return res.status(400).json({ error: 'IFRS 18 categories apply only to Revenue and Expense accounts' });
      account.ifrs18Category = ifrs18Category;
    }
    if (norm(ifrs18Line) !== undefined) {
      if (ifrs18Line !== null && !IFRS18_LINES.includes(ifrs18Line)) return res.status(400).json({ error: 'Invalid presentation line' });
      account.ifrs18Line = ifrs18Line;
    }
    if (norm(bsClass) !== undefined) {
      if (bsClass !== null && !['current', 'non_current'].includes(bsClass)) return res.status(400).json({ error: 'bsClass must be current or non_current' });
      if (!['Asset', 'Liability'].includes(account.type)) return res.status(400).json({ error: 'Current/non-current applies only to Asset and Liability accounts' });
      account.bsClass = bsClass;
    }
    await account.save();
    await logAudit(req, 'ACCOUNT_CLASSIFIED', `Reclassified ${account.code} — ${account.name} (IFRS 18: ${account.ifrs18Category || 'auto'}, line: ${account.ifrs18Line || 'auto'}, BS: ${account.bsClass || 'auto'})`);
    res.json(account);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
