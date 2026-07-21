const Company = require('../models/Company');
const mongoose = require('mongoose');

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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    // Update settings sub-object
    const settingsFields = ['invoicePrefix','nextInvoiceNumber','defaultDueDays',
      'defaultVatRate','defaultInvoiceNotes','invoiceTemplate','currency','darkMode'];
    settingsFields.forEach(f => { if (req.body[f] !== undefined) company.settings[f] = req.body[f]; });
    company.markModified('settings');
    await company.save();
    res.json({ message: 'Settings saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get company profile
exports.getProfile = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json(company);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Clear all company data
exports.clearCompanyData = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const companyId = req.user.companyId;

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

    // 2. Reset account balances to zero (preserve the accounts themselves)
    await require('../models/Account').updateMany(
      { companyId },
      { $set: { balance: 0 } }
    ).session(session);

    // 3. Reset opening balances stored in Company document (if any)
    await require('../models/Company').updateOne(
      { _id: companyId },
      { $set: { openingBalances: {} } }
    ).session(session);

    await session.commitTransaction();
    res.json({ message: 'All transactional data cleared. Chart of Accounts preserved.' });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

// ─── YEAR-END CLOSING ─────────────────────────────────────────────
exports.closeYear = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { yearToClose, newYearStartDate, lockPeriod } = req.body;
    const companyId = req.user.companyId;

    // Check if any transactions exist in the new fiscal year
    const nextYearStart = new Date(newYearStartDate);
    const existingNextYearTx = await require('../models/Invoice').findOne({ companyId, date: { $gte: nextYearStart } }).session(session);
    if (existingNextYearTx) {
      throw new Error('Transactions already exist in the new fiscal year. Cannot close previous year.');
    }

    // Get Revenue, Expense, COGS accounts
    const revenueAccounts = await require('../models/Account').find({ companyId, type: 'Revenue' }).session(session);
    const expenseAccounts = await require('../models/Account').find({ companyId, type: 'Expense' }).session(session);
    const cogsAccounts = await require('../models/Account').find({ companyId, code: '5000' }).session(session);

    let totalRevenue = revenueAccounts.reduce((sum, a) => sum + a.balance, 0);
    let totalExpenses = expenseAccounts.reduce((sum, a) => sum + a.balance, 0);
    let totalCOGS = cogsAccounts.reduce((sum, a) => sum + a.balance, 0);
    let netIncome = totalRevenue - totalExpenses - totalCOGS;

    // Find or create Retained Earnings (3000)
    let retainedEarnings = await require('../models/Account').findOne({ companyId, code: '3000' }).session(session);
    if (!retainedEarnings) {
      retainedEarnings = new (require('../models/Account'))({
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
    const allExpenseAndCogs = [...expenseAccounts, ...cogsAccounts];
    for (const acc of allExpenseAndCogs) {
      if (acc.balance !== 0) closingLines.push({ accountCode: acc.code, amount: acc.balance, type: 'credit' });
    }
    closingLines.push({ accountCode: '3000', amount: Math.abs(netIncome), type: netIncome >= 0 ? 'credit' : 'debit' });

    const closingJournal = new (require('../models/JournalEntry'))({
      companyId,
      date: new Date(yearToClose, 11, 31),
      description: `Year-end closing entries for ${yearToClose}`,
      type: 'closing',
      lines: closingLines
    });
    await closingJournal.save({ session });

    // Zero out revenue, expense, COGS accounts
    for (const acc of revenueAccounts) { acc.balance = 0; await acc.save({ session }); }
    for (const acc of allExpenseAndCogs) { acc.balance = 0; await acc.save({ session }); }
    retainedEarnings.balance += netIncome;
    await retainedEarnings.save({ session });

    // Store closed year in company settings
    await require('../models/Company').updateOne(
      { _id: companyId },
      { $push: { closedYears: yearToClose }, $set: { lastClosingDate: new Date() } }
    ).session(session);

    if (lockPeriod) {
      await require('../models/Company').updateOne(
        { _id: companyId },
        { $set: { lockedUntilDate: new Date(yearToClose, 11, 31) } }
      ).session(session);
    }

    await session.commitTransaction();
    res.json({ message: `Year ${yearToClose} closed successfully. Net income: ${netIncome.toFixed(2)} transferred to Retained Earnings.`, netIncome });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};