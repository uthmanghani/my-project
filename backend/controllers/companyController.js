const Company = require('../models/Company');
const AppError = require('../utils/AppError');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const mongoose = require('mongoose');
const { logAudit } = require('../utils/auditLog');
const INDUSTRIES = require('../utils/industryData');

// Version fingerprint -- reported by GET /health so a deploy of this fix can
// be verified from a browser, the same way bankController/billController are.
exports.__VERSION__ = 'company-controller-2026-clear-removes-orphan-bank-ledger-accounts';

// Get company settings
exports.getSettings = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    res.json({
      // Top-level fields — mapped to what frontend expects
      companyName:         company.name,
      companyLegalName:    company.legalName      || company.name,
      companyTaxId:        company.tin,
      companyPhone:        company.phone,
      companyEmail:        company.email,
      companyAddress:      company.address,
      rcNumber:            company.rcNumber,
      industry:            company.industry,

      // Settings sub-object
      invoicePrefix:       company.settings?.invoicePrefix       || 'INV-',
      nextInvoiceNumber:   company.settings?.nextInvoiceNumber   || 1,
      defaultDueDays:      company.settings?.defaultDueDays      || 30,
      defaultVatRate:      company.settings?.defaultVatRate       || 7.5,
      defaultInvoiceNotes: company.settings?.defaultInvoiceNotes || 'Thank you for your business.',
      invoiceTemplate:     company.settings?.invoiceTemplate     || 'classic',
      currency:            company.settings?.currency             || '₦',
      darkMode:            company.settings?.darkMode             || false,

      // NTA 2025 Small Company status
      isSmallCompany:                  company.taxStatus?.isSmallCompany                  || false,
      isProfessionalServices:          company.taxStatus?.isProfessionalServices          || false,
      smallCompanyTurnoverThreshold:   company.taxStatus?.smallCompanyTurnoverThreshold   ?? 100000000,
      smallCompanyFixedAssetThreshold: company.taxStatus?.smallCompanyFixedAssetThreshold ?? 250000000,
      whtDeMinimisThreshold:           company.taxStatus?.whtDeMinimisThreshold           ?? 2000000,

      // Bill maker-checker threshold — read by billController.create() to
      // decide whether a non-admin's bill needs approval before posting.
      approvalThreshold:               company.approvalThreshold ?? 500000,
    });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Update company settings
exports.updateSettings = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    // Update top-level company fields
    if (req.body.companyName) company.name = req.body.companyName;
    if (req.body.companyLegalName) company.legalName = req.body.companyLegalName;
    if (req.body.companyTaxId) company.tin = req.body.companyTaxId;
    if (req.body.companyPhone) company.phone = req.body.companyPhone;
    if (req.body.companyEmail) company.email = req.body.companyEmail;
    if (req.body.companyAddress) company.address = req.body.companyAddress;

    // Bill maker-checker threshold. Gated to admins here as well as (if
    // present) at the route level — this number controls whether a
    // non-admin's bill posts immediately or waits for sign-off, so letting
    // any authenticated user lower or raise it would defeat the workflow.
    if (req.body.approvalThreshold !== undefined) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can change the approval threshold' });
      }
      const parsed = Number(req.body.approvalThreshold);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res.status(400).json({ error: 'Approval threshold must be a non-negative number' });
      }
      company.approvalThreshold = parsed;
    }
    // Update settings sub-object
    const settingsFields = ['invoicePrefix','nextInvoiceNumber','defaultDueDays',
      'defaultVatRate','defaultInvoiceNotes','invoiceTemplate','currency','darkMode','companyLogo'];
    settingsFields.forEach(f => { if (req.body[f] !== undefined) company.settings[f] = req.body[f]; });
    company.markModified('settings');

    // NTA 2025 Small Company tax status — logged separately since this
    // directly changes VAT/CIT compliance behavior, not just cosmetic settings.
    const taxFields = ['isSmallCompany','isProfessionalServices','smallCompanyTurnoverThreshold','smallCompanyFixedAssetThreshold','whtDeMinimisThreshold'];
    const taxFieldsChanged = taxFields.some(f => req.body[f] !== undefined);
    if (taxFieldsChanged) {
      company.taxStatus = company.taxStatus || {};
      taxFields.forEach(f => { if (req.body[f] !== undefined) company.taxStatus[f] = req.body[f]; });
      company.markModified('taxStatus');
    }

    await company.save();

    if (taxFieldsChanged) {
      await logAudit(req, 'TAX_STATUS_CHANGED', `Updated NTA 2025 tax status — Small Company: ${company.taxStatus.isSmallCompany ? 'Yes' : 'No'}, Professional Services: ${company.taxStatus.isProfessionalServices ? 'Yes' : 'No'}`);
    }

    res.json({ message: 'Settings saved successfully' });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Get company profile
exports.getProfile = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json(company);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Clear all company data
exports.clearCompanyData = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const companyId = req.user.companyId;

    // Remove every bank account's ledger account from the Chart of Accounts.
    // Bank ledger accounts are created automatically by the Banking module
    // (createBankAccount), so once the bank accounts themselves are cleared
    // and re-created there, the old ones are just dead rows. Two groups:
    //
    //  1. Ledger accounts a BankAccount record still points at, active or
    //     not. (Deleting a bank account in the Banking module only
    //     DEACTIVATES it, so these are still linked.)
    //  2. ORPHANS: ledger accounts whose BankAccount record is already
    //     gone -- left behind by an earlier clear, which used to delete the
    //     BankAccount rows but only deactivate their ledger accounts. With
    //     no BankAccount to point at them, group 1 can never find these, so
    //     they piled up in the Chart of Accounts forever. They are
    //     recognised by what the Banking module leaves behind: an INACTIVE
    //     Asset account inside the code ranges it allocates from (legacy
    //     1010-1090, current 1500-1990). Codes any industry template seeds
    //     (e.g. 1500 Land & Building, 1050 Central Bank Reserve) are never
    //     treated as orphans, whatever their state.
    //
    // Deleting is safe: every journal entry is wiped in this same
    // transaction, so nothing is left referencing these codes. '1000' is
    // never removed -- it's the default Cash account seeded with the
    // company, which a legacy bank account may also point at.
    const BankAccount = require('../models/BankAccount');
    const AccountModel = require('../models/Account');
    const linkedBankAccounts = await BankAccount.find({ companyId }).session(session);
    const linkedCodes = linkedBankAccounts.map(b => b.code).filter(c => c && c !== '1000');

    const templateCodes = new Set();
    for (const industry of INDUSTRIES) {
      for (const acc of industry.accounts) templateCodes.add(acc.code);
    }
    const BANK_LEDGER_CODE = /^(10[1-9]0|1[5-9]\d0)$/;
    const inactiveAssets = await AccountModel.find(
      { companyId, type: 'Asset', isActive: false }
    ).session(session);
    const orphanCodes = inactiveAssets
      .map(a => a.code)
      .filter(c => BANK_LEDGER_CODE.test(c) && !templateCodes.has(c));

    const staleCodes = [...new Set([...linkedCodes, ...orphanCodes])];
    if (staleCodes.length) {
      await AccountModel.deleteMany(
        { companyId, code: { $in: staleCodes } }
      ).session(session);
    }

    // 1. Delete all transactional data (keep Accounts array)
    const modelsToDelete = [
      require('../models/Customer'),
      require('../models/Vendor'),
      require('../models/Product'),
      require('../models/Invoice'),
      require('../models/Bill'),
      require('../models/JournalEntry'),
      require('../models/Employee'),
      require('../models/Asset'),
      require('../models/Budget'),
      require('../models/Payment'),
      require('../models/BankTransaction'),
      require('../models/BankAccount'),
      require('../models/AuditLog')
    ];
    for (const Model of modelsToDelete) {
      await Model.deleteMany({ companyId }).session(session);
    }

    // 2. Reset account balances to zero (preserve the accounts themselves).
    // Also resets openingBalance — this was the actual bug: Account has
    // TWO balance-related fields (the live 'balance' and the separately-
    // stored 'openingBalance' that the Opening Balances screen reads back).
    // Only 'balance' was being cleared before, so re-opening Opening
    // Balances after a "clear" still showed the old figures, since nothing
    // ever reset the field it actually reads from.
    await require('../models/Account').updateMany(
      { companyId },
      { $set: { balance: 0, openingBalance: 0 } }
    ).session(session);

    await logAudit(req, 'COMPANY_DATA_CLEARED', `Cleared all transactional data (Chart of Accounts preserved; ${staleCodes.length} bank ledger account(s) removed).`, session);

    await session.commitTransaction();
    res.json({ message: 'All transactional data cleared. Chart of Accounts preserved.', bankLedgerAccountsRemoved: staleCodes.length });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    session.endSession();
  }
};

// ─── CONTROLLED PERIOD REOPENING ──────────────────────────────────
// Locking a period only means something if reopening it is deliberate
// and recorded — this endpoint requires a reason, is admin-only (enforced
// at the route level), and keeps a permanent history of every reopen,
// separate from just silently changing lockedUntilDate.
exports.reopenPeriod = async (req, res) => {
  try {
    const { reason, newLockDate } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A reason is required to reopen a locked period.' });
    }
    const company = await Company.findById(req.user.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    if (!company.lockedUntilDate) {
      return res.status(400).json({ error: 'No period is currently locked.' });
    }

    const previousLockDate = company.lockedUntilDate;
    company.reopenHistory = company.reopenHistory || [];
    company.reopenHistory.push({
      reopenedAt: new Date(),
      reopenedBy: req.user.userId,
      reason: reason.trim(),
      previousLockDate
    });
    // Either fully reopen (no lock at all) or move the lock date earlier
    // (partial reopen — e.g. reopening just the most recent closed month
    // while keeping everything before it locked).
    company.lockedUntilDate = newLockDate ? new Date(newLockDate) : null;
    await company.save();

    await logAudit(
      req,
      'PERIOD_REOPENED',
      `Reopened period locked until ${previousLockDate.toISOString().split('T')[0]}${newLockDate ? ` — new lock date ${newLockDate}` : ' — fully unlocked'}. Reason: ${reason.trim()}`
    );

    res.json({
      message: 'Period reopened. Remember to re-lock once corrections are complete.',
      lockedUntilDate: company.lockedUntilDate
    });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// ─── YEAR-END CLOSING ─────────────────────────────────────────────
exports.closeYear = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { yearToClose, newYearStartDate, lockPeriod } = req.body;
    const companyId = req.user.companyId;

    const company = await Company.findById(companyId).session(session);
    if (!company) throw new AppError('Company not found', 404);

    // Guard against closing the same year twice — without this, re-running
    // close-year would zero already-zeroed accounts and credit Retained
    // Earnings with the same net income a second time.
    if ((company.closedYears || []).includes(yearToClose)) {
      throw new AppError(`Year ${yearToClose} has already been closed.`, 400);
    }

    // Check if any transactions exist in the new fiscal year — broadened
    // to check Bills and Journal Entries too, not just Invoices, since any
    // of them existing in the new year signals closing is happening out
    // of order.
    const nextYearStart = new Date(newYearStartDate);
    const Invoice = require('../models/Invoice');
    const Bill = require('../models/Bill');
    const [existingInvoice, existingBill, existingJournal] = await Promise.all([
      Invoice.findOne({ companyId, date: { $gte: nextYearStart } }).session(session),
      Bill.findOne({ companyId, date: { $gte: nextYearStart } }).session(session),
      JournalEntry.findOne({ companyId, date: { $gte: nextYearStart } }).session(session)
    ]);
    if (existingInvoice || existingBill || existingJournal) {
      throw new AppError('Transactions already exist in the new fiscal year. Cannot close previous year.', 400);
    }

    // Get Revenue and Expense accounts. COGS accounts are stored as
    // type 'Expense' (there's no separate COGS type in this schema), so
    // fetching them separately by code '5000' and adding both to the
    // closing entry double-counted COGS — understating net income by
    // subtracting it twice. Expense accounts alone already include it.
    const revenueAccounts = await Account.find({ companyId, type: 'Revenue' }).session(session);
    const expenseAccounts = await Account.find({ companyId, type: 'Expense' }).session(session);

    let totalRevenue = revenueAccounts.reduce((sum, a) => sum + a.balance, 0);
    let totalExpenses = expenseAccounts.reduce((sum, a) => sum + a.balance, 0);
    let netIncome = totalRevenue - totalExpenses;

    // Find or create Retained Earnings (3000)
    let retainedEarnings = await Account.findOne({ companyId, code: '3000' }).session(session);
    if (!retainedEarnings) {
      retainedEarnings = new Account({
        companyId,
        code: '3000',
        name: 'Retained Earnings',
        type: 'Equity',
        balance: 0
      });
      await retainedEarnings.save({ session });
    }

    // Build closing journal lines
    const closingLines = [];
    for (const acc of revenueAccounts) {
      if (acc.balance !== 0) closingLines.push({ accountCode: acc.code, amount: acc.balance, type: 'debit' });
    }
    for (const acc of expenseAccounts) {
      if (acc.balance !== 0) closingLines.push({ accountCode: acc.code, amount: acc.balance, type: 'credit' });
    }
    closingLines.push({ accountCode: '3000', amount: Math.abs(netIncome), type: netIncome >= 0 ? 'credit' : 'debit' });

    const closingJournal = new JournalEntry({
      companyId,
      date: new Date(yearToClose, 11, 31),
      description: `Year-end closing entries for ${yearToClose}`,
      type: 'closing',
      lines: closingLines
    });
    await closingJournal.save({ session });

    // Zero out revenue and expense accounts
    for (const acc of revenueAccounts) { acc.balance = 0; await acc.save({ session }); }
    for (const acc of expenseAccounts) { acc.balance = 0; await acc.save({ session }); }
    retainedEarnings.balance += netIncome;
    await retainedEarnings.save({ session });

    // Store closed year and lock date directly on the already-loaded
    // company document, so the fields we just added to the schema
    // actually persist this time.
    company.closedYears = company.closedYears || [];
    company.closedYears.push(yearToClose);
    company.lastClosingDate = new Date();
    if (lockPeriod) {
      company.lockedUntilDate = new Date(yearToClose, 11, 31);
    }
    await company.save({ session });

    await logAudit(req, 'YEAR_CLOSED', `Closed fiscal year ${yearToClose}. Net income ₦${netIncome.toLocaleString()} transferred to Retained Earnings.${lockPeriod ? ' Period locked.' : ''}`, session);

    await session.commitTransaction();
    res.json({ message: `Year ${yearToClose} closed successfully. Net income: ${netIncome.toFixed(2)} transferred to Retained Earnings.`, netIncome });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    session.endSession();
  }
};