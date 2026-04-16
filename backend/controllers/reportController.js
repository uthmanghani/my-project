const Account = require('../models/Account');
const Invoice = require('../models/Invoice');
const Bill = require('../models/Bill');

exports.getProfitLoss = async (req, res) => {
  try {
    const accounts = await Account.find({ companyId: req.user.companyId });
    const revenue = accounts.filter(a => a.type === 'Revenue').reduce((s, a) => s + a.balance, 0);
    const expenses = accounts.filter(a => a.type === 'Expense').reduce((s, a) => s + a.balance, 0);
    const netIncome = revenue - expenses;
    res.json({ revenue, expenses, netIncome });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
};

exports.getCashFlow = async (req, res) => {
  try {
    const accounts = await Account.find({ companyId: req.user.companyId });
    const revenue = accounts.filter(a => a.type === 'Revenue').reduce((s, a) => s + a.balance, 0);
    const expenses = accounts.filter(a => a.type === 'Expense').reduce((s, a) => s + a.balance, 0);
    const netIncome = revenue - expenses;
    const arChange = -(accounts.find(a => a.code === '1100')?.balance || 0);
    const apChange = (accounts.find(a => a.code === '2000')?.balance || 0);
    const invChange = -(accounts.find(a => a.code === '1200')?.balance || 0);
    const operatingCF = netIncome + arChange + apChange + invChange;
    const fixedAssets = accounts.filter(a => a.type === 'Asset' && (a.code.startsWith('14') || a.code.startsWith('15'))).reduce((s, a) => s + a.balance, 0);
    const investingCF = -fixedAssets;
    const equity = accounts.filter(a => a.type === 'Equity').reduce((s, a) => s + a.balance, 0);
    const financingCF = equity;
    const netCash = operatingCF + investingCF + financingCF;
    res.json({ operatingCF, investingCF, financingCF, netCash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};