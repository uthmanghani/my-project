const BankTransaction = require('../models/BankTransaction');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const mongoose = require('mongoose');
const { logAudit } = require('../utils/auditLog');

// Bank accounts are stored as Account documents with type 'Asset' and code starting with '10' or custom.
// For simplicity, we treat bank accounts as separate collection? The frontend expects a /bankaccounts endpoint.
// We'll use a separate collection to match frontend expectations, but keep it simple.
// Alternatively, we can filter accounts with type 'Asset' and name containing 'Bank'. I'll create a separate model for bank accounts to avoid complexity.

// Let's create a simple BankAccount model inline (if not already existing).
// But we already have no BankAccount model. I'll add a quick model inside this controller for brevity, but better to create a proper model.
// For production, create models/BankAccount.js. I'll do that now.

// I'll assume we have models/BankAccount.js (see below). For now, I'll write the controller assuming the model exists.

const BankAccount = require('../models/BankAccount');

// Bank account ledger codes live in the 10xx range. Every bank account
// previously defaulted to the same hardcoded code ('1000'), meaning a
// second bank account would silently share one ledger account with the
// first — mixing two banks' transactions into a single GL balance.
async function getNextBankLedgerCode(companyId, session) {
  const existing = await Account.find({ companyId, code: { $regex: /^10[0-9]0$/ } })
    .session(session)
    .sort({ code: -1 });
  if (!existing.length) return '1000';
  const maxCode = parseInt(existing[0].code, 10);
  return String(maxCode + 10);
}

exports.getBankAccounts = async (req, res) => {
  try {
    const accounts = await BankAccount.find({ companyId: req.user.companyId, isActive: { $ne: false } });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createBankAccount = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, bank, accountNumber, openingBalance } = req.body;
    const code = await getNextBankLedgerCode(req.user.companyId, session);

    // Create the matching ledger account so this balance actually shows up
    // in Trial Balance, Balance Sheet, and everywhere else that reads from
    // Account — previously the opening balance only ever lived on the
    // separate BankAccount document, invisible to the rest of the books.
    const ledgerAccount = new Account({
      companyId: req.user.companyId,
      code,
      name: bank ? `${bank} - ${name}` : name,
      type: 'Asset',
      balance: openingBalance || 0,
      openingBalance: openingBalance || 0
    });
    await ledgerAccount.save({ session });

    const bankAccount = new BankAccount({
      companyId: req.user.companyId,
      name,
      bank,
      accountNumber,
      openingBalance: openingBalance || 0,
      code
    });
    await bankAccount.save({ session });

    await session.commitTransaction();
    res.status(201).json(bankAccount);
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

exports.deleteBankAccount = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const account = await BankAccount.findOne({
      companyId: req.user.companyId,
      _id: req.params.id
    }).session(session);
    if (!account) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'Bank account not found' });
    }

    // Deactivate the ledger account instead of deleting it — past journal
    // entries still reference this code, and removing it outright would
    // break Trial Balance / General Ledger history for anything already
    // posted against it.
    if (account.code) {
      await Account.updateOne(
        { companyId: req.user.companyId, code: account.code },
        { $set: { isActive: false } }
      ).session(session);
    }

    // Deactivate the BankAccount document itself rather than hard-deleting
    // it — historical BankTransaction records reference it by bankId, and
    // removing it outright would orphan every past transaction's link back
    // to which bank it belonged to.
    account.isActive = false;
    await account.save({ session });

    await logAudit(req, 'BANK_ACCOUNT_DEACTIVATED', `Deactivated bank account ${account.name} (${account.bank || ''})`, session);

    await session.commitTransaction();
    res.json({ message: 'Bank account deactivated' });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
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

// Bulk reconcile — the frontend's "select multiple, reconcile at once" action.
// This route previously didn't exist at all on the backend.
exports.bulkReconcileTransactions = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'No transaction ids provided' });
    }
    const result = await BankTransaction.updateMany(
      { companyId: req.user.companyId, _id: { $in: ids } },
      { $set: { reconciled: true, reconciledAt: new Date() } }
    );
    const updated = await BankTransaction.find({
      companyId: req.user.companyId, _id: { $in: ids }
    });
    res.json({ modifiedCount: result.modifiedCount, transactions: updated });
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
    const bankAccount = await BankAccount.findOne({ _id: bankId, companyId: req.user.companyId }).session(session);
    if (!bankAccount) throw new Error('Bank account not found');
    const bankCode = bankAccount.code || '1000'; // fallback

    const transaction = new BankTransaction({
      companyId: req.user.companyId,
      bankId: bankAccount._id,
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