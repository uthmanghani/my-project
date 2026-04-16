const Asset = require('../models/Asset');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');

exports.getAll = async (req, res) => {
  try {
    const assets = await Asset.find({ companyId: req.user.companyId }).sort({ purchaseDate: -1 });
    res.json(assets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const asset = new Asset({ ...req.body, companyId: req.user.companyId });
    await asset.save();
    res.status(201).json(asset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.postDepreciation = async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const purchaseDate = new Date(asset.purchaseDate);
    const now = new Date();
    const monthsElapsed = (now.getFullYear() - purchaseDate.getFullYear()) * 12 +
      (now.getMonth() - purchaseDate.getMonth());
    if (monthsElapsed <= 0) return res.status(400).json({ error: 'Depreciation not due yet' });

    const depreciableAmount = asset.purchaseCost - (asset.residualValue || 0);
    const monthlyDep = depreciableAmount / (asset.usefulLifeYears * 12);
    const totalDepToPost = monthlyDep * monthsElapsed;

    const depExpenseAccount = await Account.findOne({ companyId: req.user.companyId, code: '6400' });
    const accumulatedDepAccount = await Account.findOne({ companyId: req.user.companyId, code: '1410' });
    if (!depExpenseAccount || !accumulatedDepAccount) {
      return res.status(400).json({ error: 'Required accounts not found' });
    }

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date: new Date(),
      description: `Depreciation for ${asset.name} (${monthsElapsed} months)`,
      type: 'depreciation',
      lines: [
        { accountCode: depExpenseAccount.code, amount: totalDepToPost, type: 'debit' },
        { accountCode: accumulatedDepAccount.code, amount: totalDepToPost, type: 'credit' }
      ]
    });
    await journal.save();

    depExpenseAccount.balance += totalDepToPost;
    accumulatedDepAccount.balance += totalDepToPost;
    await depExpenseAccount.save();
    await accumulatedDepAccount.save();

    res.json({ message: 'Depreciation posted', amount: totalDepToPost });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const asset = await Asset.findOneAndDelete({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json({ message: 'Asset deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};