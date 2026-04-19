const BankTransaction = require('../models/BankTransaction');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const mongoose = require('mongoose');

// Bank accounts are stored as Account documents with type 'Asset' and code starting with '10' or custom.
// For simplicity, we treat bank accounts as separate collection? The frontend expects a /bankaccounts endpoint.
// We'll use a separate collection to match frontend expectations, but keep it simple.
// Alternatively, we can filter accounts with type 'Asset' and name containing 'Bank'. I'll create a separate model for bank accounts to avoid complexity.

// Let's create a simple BankAccount model inline (if not already existing).
// But we already have no BankAccount model. I'll add a quick model inside this controller for brevity, but better to create a proper model.
// For production, create models/BankAccount.js. I'll do that now.

// I'll assume we have models/BankAccount.js (see below). For now, I'll write the controller assuming the model exists.

const BankAccount = require('../models/BankAccount');

exports.getBankAccounts = async (req, res) => {
  try {
    const accounts = await BankAccount.find({ companyId: req.user.companyId });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createBankAccount = async (req, res) => {
  try {
    const { name, bank, accountNumber, openingBalance } = req.body;
    const bankAccount = new BankAccount({
      companyId: req.user.companyId,
      name,
      bank,
      accountNumber,
      openingBalance: openingBalance || 0
    });
    await bankAccount.save();
    // Also create a corresponding Account in the chart of accounts?
    // The frontend uses a separate list; we'll keep it separate.
    res.status(201).json(bankAccount);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteBankAccount = async (req, res) => {
  try {
    const account = await BankAccount.findOneAndDelete({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!account) return res.status(404).json({ error: 'Bank account not found' });
    res.json({ message: 'Bank account deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Bank transactions
exports.getBankTransactions = async (req, res) => {
  try {
    const transactions = await BankTransaction.find({ companyId: req.user.companyId }).sort({ date: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.reconcileTransaction = async (req, res) => {
  try {
    const tx = await BankTransaction.findOne({
      companyId: req.user.companyId, _id: req.params.id
    });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    tx.reconciled = !tx.reconciled;
    tx.reconciledAt = tx.reconciled ? new Date() : null;
    await tx.save();
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
 
exports.createBankTransaction = async (req, res) => {

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { bankId, date, type, amount, description, reference } = req.body;
    // Find the bank account to get its code
    const bankAccount = await BankAccount.findById(bankId).session(session);
    if (!bankAccount) throw new Error('Bank account not found');
    const bankCode = bankAccount.code || '1000'; // fallback

    const transaction = new BankTransaction({
      companyId: req.user.companyId,
      bankAccountCode: bankCode,
      date,
      type,
      amount,
      description,
      reference,
      reconciled: false
    });
    await transaction.save({ session });

    // Post journal entry: Dr/Cr Cash, Cr/Dr Suspense
    let suspenseAccount = await Account.findOne({ companyId: req.user.companyId, code: '9999' }).session(session);
    if (!suspenseAccount) {
      suspenseAccount = new Account({
        companyId: req.user.companyId,
        code: '9999',
        name: 'Suspense / Unallocated',
        type: 'Asset',
        balance: 0
      });
      await suspenseAccount.save({ session });
    }
    const cashAccount = await Account.findOne({ companyId: req.user.companyId, code: bankCode }).session(session);
    if (!cashAccount) throw new Error('Cash account not found');

    const journalLines = type === 'credit'
      ? [
          { accountCode: cashAccount.code, amount, type: 'debit' },
          { accountCode: suspenseAccount.code, amount, type: 'credit' }
        ]
      : [
          { accountCode: suspenseAccount.code, amount, type: 'debit' },
          { accountCode: cashAccount.code, amount, type: 'credit' }
        ];
    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date,
      description: description + (reference ? ` [Ref: ${reference}]` : ''),
      type: 'bank',
      lines: journalLines
    });
    await journal.save({ session });

    // Update account balances
    if (type === 'credit') {
      cashAccount.balance += amount;
      suspenseAccount.balance -= amount;
    } else {
      cashAccount.balance -= amount;
      suspenseAccount.balance += amount;
    }
    await cashAccount.save({ session });
    await suspenseAccount.save({ session });

    await session.commitTransaction();
    res.status(201).json(transaction);
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};