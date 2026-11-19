const Account = require('../models/Account');
const AppError = require('../utils/AppError');
const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');
const JournalEntry = require('../models/JournalEntry');
const BankAccount = require('../models/BankAccount');
const Company = require('../models/Company');
const IFRS18 = require('../utils/ifrs18');

// Industries whose MAIN business is lending/investing: under IFRS 18 their
// interest and investment income/expense belong in the OPERATING category.
const FINANCIAL_INDUSTRIES = ['fintech'];

const isoDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

async function loadLedger(req) {
  const companyId = req.user.companyId;
  const [accounts, entries, banks, company] = await Promise.all([
    Account.find({ companyId }).lean(),
    JournalEntry.find({ companyId }).lean(),
    BankAccount.find({ companyId }).lean(),
    Company.findById(companyId).lean()
  ]);
  const openingBalances = {};
  accounts.forEach((a) => { if (a.openingBalance) openingBalances[a.code] = a.openingBalance; });
  const opts = {
    openingBalances,
    bankCodes: banks.filter((b) => b.code).map((b) => String(b.code)),
    financialBusiness: FINANCIAL_INDUSTRIES.includes(company && company.industry),
    mpmTaxRate: 0
  };
  return { accounts, entries, opts };
}

function periodFrom(req) {
  const to = isoDay(req.query.to) || new Date().toISOString().slice(0, 10);
  const from = isoDay(req.query.from) || `${to.slice(0, 4)}-01-01`;
  if (from > to) throw new AppError('"from" must not be after "to"', 400);
  return { from, to };
}

const shiftYear = (iso, n) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;

// GET /api/reports/ifrs18/profit-or-loss?from=YYYY-MM-DD&to=YYYY-MM-DD&mpmTaxRate=0.3
exports.getIfrs18ProfitOrLoss = async (req, res) => {
  try {
    const { accounts, entries, opts } = await loadLedger(req);
    const period = periodFrom(req);
    const o = Object.assign({}, opts, { mpmTaxRate: Math.min(Math.max(Number(req.query.mpmTaxRate) || 0, 0), 1) });
    const current = IFRS18.statementOfProfitOrLoss(accounts, entries, period, o);
    const comparative = IFRS18.statementOfProfitOrLoss(accounts, entries, { from: shiftYear(period.from, -1), to: shiftYear(period.to, -1) }, o);
    res.json({ standard: 'IFRS 18', current, comparative });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// GET /api/reports/ifrs18/cash-flows
exports.getIfrs18CashFlows = async (req, res) => {
  try {
    const { accounts, entries, opts } = await loadLedger(req);
    const period = periodFrom(req);
    const current = IFRS18.statementOfCashFlows(accounts, entries, period, opts);
    const comparative = IFRS18.statementOfCashFlows(accounts, entries, { from: shiftYear(period.from, -1), to: shiftYear(period.to, -1) }, opts);
    res.json({ standard: 'IAS 7 as amended by IFRS 18', current, comparative });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// GET /api/reports/ifrs18/financial-position?asAt=YYYY-MM-DD
exports.getIfrs18FinancialPosition = async (req, res) => {
  try {
    const { accounts, entries, opts } = await loadLedger(req);
    const asAt = isoDay(req.query.asAt) || new Date().toISOString().slice(0, 10);
    res.json({
      standard: 'IAS 1 (statement of financial position)',
      current: IFRS18.statementOfFinancialPosition(accounts, entries, asAt, opts),
      comparative: IFRS18.statementOfFinancialPosition(accounts, entries, shiftYear(asAt, -1), opts)
    });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// GET /api/reports/integrity  — ledger audit (unbalanced journals, unknown codes, balance drift)
exports.getIntegrity = async (req, res) => {
  try {
    const { accounts, entries, opts } = await loadLedger(req);
    const findings = IFRS18.integrityChecks(accounts, entries, opts.openingBalances);
    res.json({ ok: findings.length === 0, findings });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.getProfitLoss = async (req, res) => {
  try {
    const accounts = await Account.find({ companyId: req.user.companyId });
    const revenue = accounts.filter(a => a.type === 'Revenue').reduce((s, a) => s + a.balance, 0);
    const expenses = accounts.filter(a => a.type === 'Expense').reduce((s, a) => s + a.balance, 0);
    const netIncome = revenue - expenses;
    res.json({ revenue, expenses, netIncome });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.getBalanceSheet = async (req, res) => {
  try {
    const accounts = await Account.find({ companyId: req.user.companyId });
    const assets = accounts.filter(a => a.type === 'Asset').reduce((s, a) => s + a.balance, 0);
    const liabilities = accounts.filter(a => a.type === 'Liability').reduce((s, a) => s + Math.abs(a.balance), 0);
    const equity = accounts.filter(a => a.type === 'Equity').reduce((s, a) => s + a.balance, 0);
    res.json({ assets, liabilities, equity });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.getTrialBalance = async (req, res) => {
  try {
    const accounts = await Account.find({ companyId: req.user.companyId });
    const trialBalance = accounts.map(a => {
      const isDebitNormal = a.type === 'Asset' || a.type === 'Expense' || a.name.toLowerCase().includes('drawing');
      const debit = isDebitNormal && a.balance > 0 ? a.balance : (!isDebitNormal && a.balance < 0 ? Math.abs(a.balance) : 0);
      const credit = !isDebitNormal && a.balance > 0 ? a.balance : (isDebitNormal && a.balance < 0 ? Math.abs(a.balance) : 0);
      return { code: a.code, name: a.name, type: a.type, debit, credit };
    });
    const totalDebit = trialBalance.reduce((s, a) => s + a.debit, 0);
    const totalCredit = trialBalance.reduce((s, a) => s + a.credit, 0);
    res.json({ trialBalance, totalDebit, totalCredit });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.getVATSummary = async (req, res) => {
  try {
    const invoices = await Invoice.find({ companyId: req.user.companyId });
    const bills = await Bill.find({ companyId: req.user.companyId });
    const outputVAT = invoices.reduce((s, i) => s + (i.vat || 0), 0);
    const inputVAT = bills.reduce((s, b) => s + (b.vat || 0), 0);
    const netVAT = outputVAT - inputVAT;
    res.json({ outputVAT, inputVAT, netVAT });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Legacy endpoint kept for old clients. It used to treat the ENTIRE equity balance
// as financing cash flow and ignored opening balances; it now delegates to the
// IFRS 18-aligned engine and keeps the old response keys.
exports.getCashFlow = async (req, res) => {
  try {
    const { accounts, entries, opts } = await loadLedger(req);
    const cf = IFRS18.statementOfCashFlows(accounts, entries, periodFrom(req), opts);
    res.json({ operatingCF: cf.netOperating, investingCF: cf.netInvesting, financingCF: cf.netFinancing, netCash: cf.netChange, reconciled: cf.reconciled, statement: cf });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
