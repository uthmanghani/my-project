const Asset = require('../models/Asset');
const AppError = require('../utils/AppError');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');
const { logAudit } = require('../utils/auditLog');

exports.getAll = async (req, res) => {
  try {
    const assets = await Asset.find({ companyId: req.user.companyId, isActive: { $ne: false } }).sort({ purchaseDate: -1 });
    res.json(assets);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.create = async (req, res) => {
  try {
    const asset = new Asset({ ...req.body, companyId: req.user.companyId });
    await asset.save();
    res.status(201).json(asset);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.postDepreciation = async (req, res) => {
  try {
    // SECURITY: was Asset.findById(req.params.id) with no companyId check —
    // any authenticated user of ANY company could post depreciation against
    // another company's asset. It still used req.user.companyId for the
    // journal and accounts, so the effect was corrupting the ATTACKER'S own
    // company's ledger with a stranger's asset numbers. Always scope by
    // companyId, exactly like every other lookup in this file already does.
    const asset = await Asset.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const depreciableAmount = asset.purchaseCost - (asset.residualValue || 0);
    const monthlyDep = depreciableAmount / (asset.usefulLifeYears * 12);
    const now = new Date();

    // Charge only the months NOT already posted — previously this summed
    // depreciation from purchaseDate every single run, so clicking "Post
    // Depreciation" twice charged the same months twice. lastDepreciationDate
    // (added to the Asset model) makes each run pick up where the last left off.
    const since = asset.lastDepreciationDate ? new Date(asset.lastDepreciationDate) : new Date(asset.purchaseDate);
    const monthsElapsed = (now.getFullYear() - since.getFullYear()) * 12 +
      (now.getMonth() - since.getMonth());
    if (monthsElapsed <= 0) {
      return res.status(400).json({
        error: asset.lastDepreciationDate
          ? 'Depreciation for the current month has already been posted for this asset.'
          : 'Depreciation not due yet.'
      });
    }

    // Never depreciate past the residual value, even if postings were missed
    // for a long stretch and monthsElapsed overshoots the remaining life.
    const remaining = Math.max(0, depreciableAmount - (asset.accumulatedDepreciation || 0));
    const totalDepToPost = Math.min(monthlyDep * monthsElapsed, remaining);
    if (totalDepToPost <= 0.005) {
      return res.status(400).json({ error: 'This asset is already fully depreciated.' });
    }

    const depExpenseAccount = await Account.findOne({ companyId: req.user.companyId, code: '6400' });
    const accumulatedDepAccount = await Account.findOne({ companyId: req.user.companyId, code: '1410' });
    if (!depExpenseAccount || !accumulatedDepAccount) {
      return res.status(400).json({ error: 'Required accounts not found' });
    }

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date: new Date(),
      description: `Depreciation for ${asset.name} (${monthsElapsed} month${monthsElapsed === 1 ? '' : 's'})`,
      type: 'depreciation',
      referenceType: null,
      referenceId: asset._id,
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

    asset.accumulatedDepreciation = (asset.accumulatedDepreciation || 0) + totalDepToPost;
    asset.lastDepreciationDate = now;
    await asset.save();

    res.json({ message: 'Depreciation posted', amount: totalDepToPost, monthsPosted: monthsElapsed, accumulatedDepreciation: asset.accumulatedDepreciation });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.delete = async (req, res) => {
  try {
    const asset = await Asset.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      { isActive: false },
      { new: true }
    );
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    await logAudit(req, 'ASSET_DEACTIVATED', `Deactivated asset ${asset.name}`);
    res.json({ message: 'Asset deactivated' });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};