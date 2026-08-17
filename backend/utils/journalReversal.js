const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');

/**
 * Reverses a posted journal entry with a mirrored entry (every debit line
 * becomes a credit of the same amount and vice versa), dated today. The
 * original entry is never deleted — it's marked voided and linked to the
 * reversal that superseded it, so the full history stays traceable.
 *
 * Must be called inside an active Mongoose session/transaction.
 *
 * @returns the newly created reversal JournalEntry document
 */
async function reverseJournalEntry({ entryId, companyId, userId, reason, session }) {
  const original = await JournalEntry.findOne({ _id: entryId, companyId }).session(session);
  if (!original) throw new Error('Journal entry not found');
  if (original.voided) throw new Error('This journal entry has already been voided');

  const reversedLines = original.lines.map(l => ({
    accountCode: l.accountCode,
    amount: l.amount,
    type: l.type === 'debit' ? 'credit' : 'debit'
  }));

  const reversal = new JournalEntry({
    companyId,
    date: new Date(),
    description: `Reversal of: ${original.description}`,
    type: original.type,
    referenceType: original.referenceType,
    referenceId: original.referenceId,
    lines: reversedLines,
    reversalOf: original._id
  });
  await reversal.save({ session });

  for (const line of reversedLines) {
    const account = await Account.findOne({ companyId, code: line.accountCode }).session(session);
    if (account) {
      if (line.type === 'debit') account.balance += line.amount;
      else account.balance -= line.amount;
      await account.save({ session });
    }
  }

  original.voided = true;
  original.voidedAt = new Date();
  original.voidedBy = userId;
  original.voidReason = reason || null;
  original.reversedBy = reversal._id;
  await original.save({ session });

  return reversal;
}

/**
 * Reverses every (non-voided) journal entry tied to a given source document
 * (a Bill or Invoice, via referenceType/referenceId) — used when voiding
 * the source document itself, since a Bill or Invoice can have posted
 * multiple journal entries (the main entry, plus e.g. a COGS entry).
 */
async function reverseAllEntriesFor({ referenceType, referenceId, companyId, userId, reason, session }) {
  const entries = await JournalEntry.find({
    companyId, referenceType, referenceId, voided: { $ne: true }
  }).session(session);
  const reversals = [];
  for (const entry of entries) {
    reversals.push(await reverseJournalEntry({
      entryId: entry._id, companyId, userId, reason, session
    }));
  }
  return reversals;
}

module.exports = { reverseJournalEntry, reverseAllEntriesFor };
