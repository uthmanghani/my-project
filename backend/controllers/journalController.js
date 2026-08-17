const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');
const mongoose = require('mongoose');
const { reverseJournalEntry } = require('../utils/journalReversal');
const { logAudit } = require('../utils/auditLog');

exports.getAll = async (req, res) => {
  try {
    const entries = await JournalEntry.find({ companyId: req.user.companyId }).sort({ date: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { date, description, lines, type } = req.body;
    let debits = 0, credits = 0;
    for (const line of lines) {
      if (line.type === 'debit') debits += line.amount;
      else credits += line.amount;
    }
    if (Math.abs(debits - credits) > 0.01) {
      return res.status(400).json({ error: 'Debits must equal credits' });
    }
    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date,
      description,
      type: type || 'journal',
      lines
    });
    await journal.save();
    for (const line of lines) {
      const account = await Account.findOne({ companyId: req.user.companyId, code: line.accountCode });
      if (account) {
        if (line.type === 'debit') account.balance += line.amount;
        else account.balance -= line.amount;
        await account.save();
      }
    }
    await logAudit(req, 'JOURNAL_CREATED', `Posted manual journal — ${description} (₦${debits.toLocaleString()})`);
    res.status(201).json(journal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.voidEntry = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const reversal = await reverseJournalEntry({
      entryId: req.params.id,
      companyId: req.user.companyId,
      userId: req.user.userId,
      reason: req.body.reason,
      session
    });
    await logAudit(req, 'JOURNAL_VOIDED', `Voided journal entry ${req.params.id}${req.body.reason ? ' — ' + req.body.reason : ''}`, session);
    await session.commitTransaction();
    res.json({ message: 'Journal entry voided. A reversing entry has been posted.', reversalEntry: reversal });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ error: err.message });
  } finally {
    session.endSession();
  }
};