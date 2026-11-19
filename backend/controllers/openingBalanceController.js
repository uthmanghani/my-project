const Account = require('../models/Account');
const AppError = require('../utils/AppError');
const JournalEntry = require('../models/JournalEntry');
const mongoose = require('mongoose');

exports.getOpeningBalances = async (req, res) => {
  try {
    const accounts = await Account.find({ companyId: req.user.companyId });
    const openingBalances = {};
    accounts.forEach(acc => {
      if (acc.openingBalance !== 0) openingBalances[acc.code] = acc.openingBalance;
    });
    res.json(openingBalances);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.setOpeningBalances = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const newBalances = req.body; // { accountCode: amount }
    for (const [code, balance] of Object.entries(newBalances)) {
      const account = await Account.findOne({ companyId: req.user.companyId, code }).session(session);
      if (account) {
        const newOB = Number(balance);
        if (!Number.isFinite(newOB)) throw new AppError(`Opening balance for ${code} must be a number`, 400);
        // Shift the running balance by the change in opening balance; overwriting it
        // would erase every journal movement already posted to this account.
        account.balance = (account.balance || 0) + (newOB - (account.openingBalance || 0));
        account.openingBalance = newOB;
        await account.save({ session });
      }
    }
    await session.commitTransaction();
    res.json({ message: 'Opening balances updated' });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    session.endSession();
  }
};