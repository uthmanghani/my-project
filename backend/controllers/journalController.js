const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');

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
    const { date, description, lines } = req.body;
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
      type: 'journal',
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
    res.status(201).json(journal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const journal = await JournalEntry.findOneAndDelete({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!journal) return res.status(404).json({ error: 'Journal entry not found' });
    for (const line of journal.lines) {
      const account = await Account.findOne({ companyId: req.user.companyId, code: line.accountCode });
      if (account) {
        if (line.type === 'debit') account.balance -= line.amount;
        else account.balance += line.amount;
        await account.save();
      }
    }
    res.json({ message: 'Journal entry deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};