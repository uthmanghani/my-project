const test = require('node:test');
const assert = require('node:assert');
const F = require('../utils/ifrs18');

const A = (code, name, type) => ({ code, name, type, balance: 0 });
const accounts = [
  A('1000', 'Cash & Cash Equivalents', 'Asset'), A('1100', 'Accounts Receivable', 'Asset'),
  A('1200', 'Merchandise Inventory', 'Asset'), A('1400', 'Store Equipment', 'Asset'),
  A('1410', 'Accumulated Depreciation', 'Asset'), A('1110', 'Interest Receivable', 'Asset'),
  A('2000', 'Accounts Payable', 'Liability'), A('2100', 'VAT Payable (7.5%)', 'Liability'),
  A('2400', 'Bank Loans Payable', 'Liability'), A('2500', 'Interest Payable', 'Liability'),
  A('2600', 'Income Tax Payable', 'Liability'),
  A('3000', 'Owner Capital', 'Equity'), A('3100', 'Retained Earnings', 'Equity'), A('3200', 'Drawings', 'Equity'),
  A('4000', 'Sales Revenue', 'Revenue'), A('4500', 'Interest Income', 'Revenue'),
  A('5000', 'Cost of Goods Sold', 'Expense'), A('6000', 'Salaries & Wages', 'Expense'),
  A('6300', 'Advertising & Promotions', 'Expense'), A('6400', 'Depreciation Expense', 'Expense'),
  A('6200', 'Utilities', 'Expense'), A('7000', 'Interest Expense', 'Expense'), A('8000', 'Income Tax Expense', 'Expense')
];
const J = (date, lines, type) => ({ date, description: 'x', type: type || 'journal', lines: lines.map(([c, t, amount]) => ({ accountCode: c, type: t, amount })) });
const entries = [
  J('2026-01-02', [['1000', 'debit', 1000], ['1400', 'debit', 0], ['3000', 'credit', 1000]]),
  J('2026-01-03', [['1400', 'debit', 400], ['1000', 'credit', 400]]),               // capex
  J('2026-02-01', [['1100', 'debit', 600], ['4000', 'credit', 600]]),               // credit sales
  J('2026-02-02', [['1000', 'debit', 200], ['4000', 'credit', 200]]),               // cash sales
  J('2026-02-03', [['5000', 'debit', 300], ['1200', 'credit', 300]]),               // COGS
  J('2026-02-04', [['1200', 'debit', 500], ['2000', 'credit', 500]]),               // stock on credit
  J('2026-02-05', [['6000', 'debit', 100], ['1000', 'credit', 100]]),
  J('2026-02-06', [['6300', 'debit', 50], ['1000', 'credit', 50]]),
  J('2026-02-07', [['6400', 'debit', 40], ['1410', 'credit', 40]]),                 // depreciation
  J('2026-02-08', [['1000', 'debit', 300], ['2400', 'credit', 300]]),               // loan drawn
  J('2026-02-09', [['7000', 'debit', 30], ['1000', 'credit', 20], ['2500', 'credit', 10]]), // interest 20 paid 10 accrued
  J('2026-02-10', [['1000', 'debit', 15], ['1110', 'debit', 5], ['4500', 'credit', 20]]),   // interest income 15 rec 5 accrued
  J('2026-02-11', [['8000', 'debit', 25], ['2600', 'credit', 25]]),                 // tax accrued
  J('2026-02-12', [['2600', 'debit', 10], ['1000', 'credit', 10]]),                 // tax paid 10
  J('2026-02-13', [['3200', 'debit', 60], ['1000', 'credit', 60]])                  // drawings
];
const period = { from: '2026-01-01', to: '2026-12-31' };

test('IFRS 18 categories, subtotals and function lines', () => {
  const s = F.statementOfProfitOrLoss(accounts, entries, period);
  assert.strictEqual(s.revenue.total, 800);
  assert.strictEqual(s.costOfSales.total, 300);
  assert.strictEqual(s.grossProfit, 500);
  // operating = 800 - 300 - 100 - 50 - 40 = 310
  assert.strictEqual(s.operatingProfit, 310);
  assert.strictEqual(s.investing.net, 20);              // interest income is INVESTING, not operating
  assert.strictEqual(s.profitBeforeFinancingAndTax, 330);
  assert.strictEqual(s.financing.net, -30);             // interest expense is FINANCING
  assert.strictEqual(s.profitBeforeTax, 300);
  assert.strictEqual(s.incomeTax.total, 25);
  assert.strictEqual(s.profitForPeriod, 275);
});

test('by-nature note and EBITDA MPM reconcile to operating profit', () => {
  const s = F.statementOfProfitOrLoss(accounts, entries, period, { mpmTaxRate: 0.3 });
  assert.strictEqual(s.byNature.totals.depreciation_amortisation, 40);
  assert.strictEqual(s.byNature.totals.employee_benefits, 100);
  assert.strictEqual(s.byNature.total, 490);            // 300+100+40+50
  const m = s.mpms[0];
  assert.strictEqual(m.amount, 350);
  assert.strictEqual(m.comparableAmount, 310);
  assert.strictEqual(m.reconciliation[0].taxEffect, -12);
});

test('overrides beat name heuristics; financial businesses keep interest in operating', () => {
  assert.strictEqual(F.classifyCategory({ name: 'Sales Revenue', type: 'Revenue', ifrs18Category: 'investing' }).category, 'investing');
  assert.strictEqual(F.classifyCategory({ name: 'Interest Income on Loans', type: 'Revenue' }, { financialBusiness: true }).category, 'operating');
  assert.strictEqual(F.classifyCategory({ name: 'PAYE Tax Payable', type: 'Expense' }).category, 'operating');
  assert.strictEqual(F.classifyCategory({ name: 'Tertiary Education Tax', type: 'Expense' }).category, 'income_tax');
});

test('closing entries do not change period results', () => {
  const closing = J('2026-12-31', [['4000', 'debit', 800], ['3100', 'credit', 800]], 'closing');
  const s = F.statementOfProfitOrLoss(accounts, entries.concat(closing), period);
  assert.strictEqual(s.revenue.total, 800);
});

test('cash flow starts at operating profit and reconciles exactly to ledger cash', () => {
  const cf = F.statementOfCashFlows(accounts, entries, period, { openingBalances: {} });
  assert.strictEqual(cf.operatingProfit, 310);
  assert.strictEqual(cf.incomeTaxPaid, -10);
  assert.strictEqual(cf.interestPaid, -20);              // 30 expense - 10 accrued
  assert.strictEqual(cf.interestAndDividendsReceived, 15); // 20 income - 5 accrued
  assert.strictEqual(cf.closingCash, 1000 - 400 + 200 + 300 - 100 - 50 - 20 + 15 - 10 - 60);
  assert.ok(cf.reconciled, 'difference ' + cf.unreconciledDifference);
});

test('cash flow with opening balances and a prior period', () => {
  const ob = { '1000': 500, '3000': 500 };
  const cf = F.statementOfCashFlows(accounts, entries, { from: '2026-02-01', to: '2026-12-31' }, { openingBalances: ob });
  assert.ok(cf.reconciled, 'difference ' + cf.unreconciledDifference);
  assert.strictEqual(cf.openingCash, 500 + 1000 - 400);
});

test('financial position: current/non-current split and balances', () => {
  const p = F.statementOfFinancialPosition(accounts, entries, '2026-12-31', { openingBalances: {} });
  assert.ok(p.balanced, 'diff ' + p.difference);
  assert.ok(p.nonCurrentAssets.lines.some((l) => l.code === '1400'));
  assert.ok(p.nonCurrentLiabilities.lines.some((l) => l.code === '2400'));
  assert.ok(p.currentLiabilities.lines.some((l) => l.code === '2000'));
  const withClosing = F.statementOfFinancialPosition(accounts, entries.concat(J('2026-12-31', [['4000', 'debit', 800], ['3100', 'credit', 800]], 'closing')), '2026-12-31', { openingBalances: {} });
  assert.strictEqual(withClosing.equity.total, p.equity.total);
  assert.ok(withClosing.balanced);
});

test('integrity checks flag unbalanced journals, unknown accounts and balance drift', () => {
  const bad = entries.concat(J('2026-03-01', [['1000', 'debit', 10], ['9999', 'credit', 5]]));
  const f = F.integrityChecks(accounts, bad, {}, '2026-12-31');
  assert.ok(f.some((x) => x.check === 'unbalanced_journal'));
  assert.ok(f.some((x) => x.check === 'unknown_account'));
  assert.ok(f.some((x) => x.check === 'balance_drift')); // stored balances are all 0 here
});
