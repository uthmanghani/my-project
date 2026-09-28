const BankTransaction = require('../models/BankTransaction');
const AppError = require('../utils/AppError');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const mongoose = require('mongoose');
const { logAudit } = require('../utils/auditLog');
// Version fingerprint — checked by GET /health so deployment status can be
// verified from any browser, with no shell or git access needed.
exports.__VERSION__ = 'bank-controller-2026-fix-getNextBankLedgerCode';

// Bank accounts are stored as Account documents with type 'Asset' and code starting with '10' or custom.
// For simplicity, we treat bank accounts as separate collection? The frontend expects a /bankaccounts endpoint.
// We'll use a separate collection to match frontend expectations, but keep it simple.
// Alternatively, we can filter accounts with type 'Asset' and name containing 'Bank'. I'll create a separate model for bank accounts to avoid complexity.

// Let's create a simple BankAccount model inline (if not already existing).
// But we already have no BankAccount model. I'll add a quick model inside this controller for brevity, but better to create a proper model.
// For production, create models/BankAccount.js. I'll do that now.

// I'll assume we have models/BankAccount.js (see below). For now, I'll write the controller assuming the model exists.

const BankAccount = require('../models/BankAccount');

// Bank account ledger codes live in the 15xx range (chosen to sit clear of
// every other reserved code block: AR=1100, Inventory=1200+, Equipment=
// 1400+). Rather than compute "highest existing + 10" and trust it blindly
// (the previous approach — which silently overflowed into 1100, AR's own
// code, once the original 1000-1090 range of only 9 slots was exhausted),
// this verifies each candidate is genuinely unused before returning it —
// the same self-healing pattern already used for invoice/bill numbering.
async function getNextBankLedgerCode(companyId, session) {
  let candidate = 1500;
  for (let i = 0; i < 200; i++) { // hard cap so a bug elsewhere can't loop forever
    const codeStr = String(candidate);
    const existing = await Account.findOne({ companyId, code: codeStr }).session(session);
    if (!existing) return codeStr;
    candidate += 10;
  }
  throw new AppError('Could not allocate a free bank account ledger code — please contact support.', 500);
}

exports.getBankAccounts = async (req, res) => {
  try {
    const accounts = await BankAccount.find({ companyId: req.user.companyId, isActive: { $ne: false } });
    res.json(accounts);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
 
// Bulk-import bank transactions parsed client-side from a CSV or OFX/QFX
// statement. Each row gets the exact same Suspense-account journal posting
// as one entered by hand via createBankTransaction below, so imported
// activity shows up in Trial Balance / the bank ledger immediately -- the
// previous "Import Statement" feature only ever pushed rows into browser
// state and called a no-op save stub, so nothing reached the database,
// no journal was posted, and the import vanished on refresh.
exports.importBankTransactions = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { bankId, transactions } = req.body;
    if (!bankId) throw new AppError('bankId is required', 400);
    if (!Array.isArray(transactions) || !transactions.length) {
      throw new AppError('No transactions to import', 400);
    }
    if (transactions.length > 2000) {
      throw new AppError('Statement is too large to import in one batch (max 2000 rows) -- split it and import in parts.', 400);
    }

    const bankAccount = await BankAccount.findOne({ _id: bankId, companyId: req.user.companyId }).session(session);
    if (!bankAccount) throw new AppError('Bank account not found', 404);
    const bankCode = bankAccount.code || '1000';

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
    if (!cashAccount) throw new AppError('Cash account not found', 400);

    // A bank-supplied reference (OFX's FITID) is the strongest dedup
    // signal when present -- it's the bank's own unique transaction id.
    // Otherwise fall back to date+type+amount+description, which is what
    // lets re-importing an overlapping CSV period (very common -- most
    // banks default their "download statement" to the last 30/90 days)
    // skip everything already on file instead of doubling every balance.
    const fingerprint = (t) =>
      (t.reference && t.reference !== 'IMPORT')
        ? `ref:${t.reference}`
        : `d:${new Date(t.date).toISOString().slice(0, 10)}|${t.type}|${Number(t.amount).toFixed(2)}|${(t.description || '').trim().toLowerCase()}`;

    const existing = await BankTransaction.find({
      companyId: req.user.companyId, bankId: bankAccount._id
    }).session(session).lean();
    const seen = new Set(existing.map(fingerprint));

    let imported = 0, duplicates = 0, invalid = 0;
    for (const raw of transactions) {
      const date = raw.date, type = raw.type, amount = Number(raw.amount);
      if (!date || (type !== 'credit' && type !== 'debit') || !(amount > 0)) { invalid++; continue; }
      const t = {
        date, type, amount,
        description: (raw.description || 'Imported').slice(0, 300),
        reference: raw.reference || 'IMPORT'
      };
      const fp = fingerprint(t);
      if (seen.has(fp)) { duplicates++; continue; }
      seen.add(fp); // also catches duplicate rows within the same file

      const transaction = new BankTransaction({
        companyId: req.user.companyId,
        bankId: bankAccount._id,
        bankAccountCode: bankCode,
        date: t.date,
        type: t.type,
        amount: t.amount,
        description: t.description,
        reference: t.reference,
        reconciled: false
      });
      await transaction.save({ session });

      const journalLines = t.type === 'credit'
        ? [
            { accountCode: cashAccount.code, amount: t.amount, type: 'debit' },
            { accountCode: suspenseAccount.code, amount: t.amount, type: 'credit' }
          ]
        : [
            { accountCode: suspenseAccount.code, amount: t.amount, type: 'debit' },
            { accountCode: cashAccount.code, amount: t.amount, type: 'credit' }
          ];
      const journal = new JournalEntry({
        companyId: req.user.companyId,
        date: t.date,
        description: `${t.description} [Ref: ${t.reference}]`,
        type: 'bank',
        lines: journalLines
      });
      await journal.save({ session });

      if (t.type === 'credit') {
        cashAccount.balance += t.amount;
        suspenseAccount.balance -= t.amount;
      } else {
        cashAccount.balance -= t.amount;
        suspenseAccount.balance += t.amount;
      }
      imported++;
    }
    await cashAccount.save({ session });
    await suspenseAccount.save({ session });

    await logAudit(
      req, 'BANK_STATEMENT_IMPORTED',
      `Imported ${imported} transaction(s) into ${bankAccount.name}` +
      (duplicates ? `, skipped ${duplicates} duplicate(s)` : '') +
      (invalid ? `, ${invalid} invalid row(s)` : ''),
      session
    );

    await session.commitTransaction();
    res.json({ imported, duplicates, invalid });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    session.endSession();
  }
};

exports.createBankTransaction = async (req, res) => {

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { bankId, date, type, amount, description, reference } = req.body;
    // Find the bank account to get its code
    const bankAccount = await BankAccount.findOne({ _id: bankId, companyId: req.user.companyId }).session(session);
    if (!bankAccount) throw new AppError('Bank account not found', 404);
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
    if (!cashAccount) throw new AppError('Cash account not found', 400);

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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    session.endSession();
  }
};