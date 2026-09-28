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
        account.openingBalance = balance;
        // Adjust current balance: new balance - old balance (difference)
        const diff = balance - (account.balance || 0);
        account.balance = balance;
        await account.save({ session });
        // Optionally post a journal entry to adjust retained earnings? Not needed if we just set balance directly.
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