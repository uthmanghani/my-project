/*
 * IFRS 18 "Presentation and Disclosure in Financial Statements" reporting engine.
 *
 * Pure functions, no I/O, no framework: the same file runs in Node (tests, API)
 * and in the browser (inlined into index.html), so the numbers on screen are the
 * numbers the tests proved.
 *
 * What it produces
 *   statementOfProfitOrLoss()  operating / investing / financing / income-tax /
 *                              discontinued categories with the IFRS 18 subtotals
 *                              (operating profit; profit before financing and
 *                              income taxes; profit for the period), expenses by
 *                              function OR by nature, the by-nature note, and an
 *                              MPM (management-defined performance measure) note.
 *   statementOfCashFlows()     indirect method STARTING FROM OPERATING PROFIT, with
 *                              interest paid in financing and interest/dividends
 *                              received in investing, tied to the ledger cash.
 *   statementOfFinancialPosition()  current / non-current split (IAS 1 retained).
 *   integrityChecks()          ledger audit: unbalanced journals, unknown account
 *                              codes, stored-vs-recomputed balance drift.
 *
 * Sign convention: every amount is in its NATURAL sign (revenue positive when it
 * earns, expense positive when it costs, assets positive when debit). Contra items
 * therefore come out negative.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IFRS18 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = ['operating', 'investing', 'financing', 'income_tax', 'discontinued'];
  const FUNCTION_LINES = ['revenue', 'other_operating_income', 'cost_of_sales', 'selling_distribution', 'administrative', 'other_operating'];
  const BS_CLASSES = ['current', 'non_current'];

  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const sum = (arr, f) => r2(arr.reduce((s, x) => s + (f ? f(x) : x), 0));
  const day = (d) => (d instanceof Date ? d.toISOString() : String(d || '')).slice(0, 10);
  const nm = (a) => String((a && a.name) || '');

  // ───────────────────────── classification ─────────────────────────

  const isDrawings = (a) => /drawing/i.test(nm(a));
  const isDebitNormal = (a) => a.type === 'Asset' || a.type === 'Expense' || isDrawings(a);

  const RE_INCOME_TAX = /(income|company|companies|corporate|corporation|tertiary education|deferred) tax|\bcit\b|\btet\b|tax expense/i;
  const RE_NOT_INCOME_TAX = /paye|vat|withholding|\bwht\b|payroll|property tax|levies? (&|and) tax|stamp|payable/i;
  const RE_FIN_EXPENSE = /interest (expense|paid|charge|cost)|interest on (loan|borrowing|overdraft|lease|debenture|bond)|finance (cost|charge|expense)|loan interest|bank interest|unwinding|lease interest/i;
  const RE_INV_INCOME = /interest (income|received|earned|revenue)|investment (income|gain)|dividend (income|received)|income from (investment|associate|joint)|fair value (gain|loss)|share of (profit|loss)|gain on (sale|disposal) of (investment|securit)|rental income (from|on) investment/i;
  const RE_DISCONTINUED = /discontinued/i;

  /** IFRS 18 category for a Revenue/Expense account. `opts.financialBusiness` = the
   *  entity's MAIN business is lending/investing (banks, microfinance): interest and
   *  investment income/expense then sit in the OPERATING category. */
  function classifyCategory(a, opts) {
    opts = opts || {};
    if (a.ifrs18Category && CATEGORIES.includes(a.ifrs18Category)) return { category: a.ifrs18Category, source: 'override' };
    const n = nm(a);
    if (RE_DISCONTINUED.test(n)) return { category: 'discontinued', source: 'auto' };
    if (a.type === 'Expense' && RE_INCOME_TAX.test(n) && !RE_NOT_INCOME_TAX.test(n)) return { category: 'income_tax', source: 'auto' };
    if (!opts.financialBusiness) {
      if (a.type === 'Expense' && RE_FIN_EXPENSE.test(n)) return { category: 'financing', source: 'auto' };
      if (a.type === 'Revenue' && RE_INV_INCOME.test(n)) return { category: 'investing', source: 'auto' };
      if (a.type === 'Expense' && /investment (loss|impairment)|loss on (sale|disposal) of (investment|securit)/i.test(n)) return { category: 'investing', source: 'auto' };
    }
    return { category: 'operating', source: 'auto' };
  }

  /** Function-of-expense line inside the operating category. */
  function classifyFunction(a) {
    const incomeLines = ['revenue', 'other_operating_income'];
    if (a.ifrs18Line && FUNCTION_LINES.includes(a.ifrs18Line) &&
        (a.type === 'Revenue') === incomeLines.includes(a.ifrs18Line)) return a.ifrs18Line; // an income line for revenue accounts, an expense line for expenses
    const n = nm(a), code = String(a.code || '');
    if (a.type === 'Revenue') {
      return /other income|grant|donation|subsid|gain on (sale|disposal)|sundry|misc/i.test(n) ? 'other_operating_income' : 'revenue';
    }
    if (/exploration|dry hole|loss on (sale|disposal)|foreign exchange|exchange (loss|difference)|\bfx\b|penalt|fines?\b/i.test(n)) return 'other_operating';
    if (/^5\d{3}$/.test(code) ||
        /cost of (goods|sales|services|food|parts|properties|pharma|software)|\bcogs\b|direct (materials|labou?r)|materials consumed|inventory write.?down|lifting|subcontract|seeds|fertili[sz]er|harvesting|royalt|technician labou?r|medical supplies/i.test(n)) return 'cost_of_sales';
    if (/marketing|advertis|promotion|packaging|shipping|distribution|transport|logistics|delivery|commission|customer acquisition|fuel/i.test(n)) return 'selling_distribution';
    return 'administrative';
  }

  /** Nature-of-expense bucket (drives the mandatory by-nature note). */
  function classifyNature(a) {
    const n = nm(a);
    if (/deprecia|amortis|amortiz|depletion/i.test(n)) return 'depreciation_amortisation';
    if (/impairment|write.?down|loan loss|bad debt|doubtful|expected credit/i.test(n)) return 'impairment_writedown';
    if (/salar|wage|labou?r|staff|payroll|pension|nsitf|\bitf\b|\bnhf\b|employee|bonus|allowance|benefit/i.test(n)) return 'employee_benefits';
    if (classifyFunction(a) === 'cost_of_sales') return 'materials_goods';
    return 'other';
  }

  const NATURE_LABELS = {
    materials_goods: 'Cost of goods, materials and direct services',
    employee_benefits: 'Employee benefits expense',
    depreciation_amortisation: 'Depreciation, amortisation and depletion',
    impairment_writedown: 'Impairment and write-downs',
    other: 'Other operating expenses'
  };
  const FUNCTION_LABELS = {
    revenue: 'Revenue', other_operating_income: 'Other operating income', cost_of_sales: 'Cost of sales',
    selling_distribution: 'Selling and distribution expenses', administrative: 'Administrative expenses', other_operating: 'Other operating expenses'
  };

  // balance-sheet side
  const RE_CASH = /\bcash\b|petty cash|bank(?!\s*loan)|moniepoint|opay|palmpay|kuda|wema|zenith|gtb|\buba\b|fidelity|stanbic|fcmb|polaris|sterling|union bank|first bank|access bank|\bpos\b|mobile money/i;
  const RE_ACCUM = /accumulated (deprec|amortis|amortiz|impair)/i;
  const RE_NONCURRENT_ASSET = /equipment|plant|machinery|vehicle|motor|furniture|fixture|building|\bland\b|propert(y|ies)|intangible|goodwill|software|computer|leasehold|biological|exploration|pipeline|improvement|capital work|\bcwip\b|tools|livestock|orchard|long.?term|right.of.use|investment(?!.*short)|accumulated/i;
  const RE_NONCURRENT_LIAB = /\bloans?\b|borrowing|debenture|mortgage|\bbond|lease liab|long.?term|deferred tax|deferred income|gratuity|retirement benefit|restoration/i;
  const RE_FINANCING_LIAB = /\bloans?\b|borrowing|debenture|mortgage|\bbond|lease liab|overdraft|long.?term|note payable|notes payable/i;
  const RE_STATUTORY = /vat|paye|pension|nsitf|\bitf\b|\bnhf\b|withholding|\bwht\b|tax payable|levy|levies/i;

  function bsClass(a, opts) {
    if (a.type === 'Equity') return 'equity';
    if (a.bsClass && BS_CLASSES.includes(a.bsClass)) return a.bsClass;
    const n = nm(a), code = parseInt(a.code, 10) || 0;
    if (a.type === 'Asset') {
      if (isCash(a, opts)) return 'current';
      if (/receivable|debtor|inventory|stock|prepa|advance|work.?in.?progress|finished goods|raw material/i.test(n) && !/long.?term/i.test(n)) return 'current';
      if (RE_NONCURRENT_ASSET.test(n)) return 'non_current';
      return code >= 1400 ? 'non_current' : 'current';
    }
    if (a.type === 'Liability') {
      if (/overdraft/i.test(n)) return 'current';
      return RE_NONCURRENT_LIAB.test(n) ? 'non_current' : 'current';
    }
    return null;
  }

  function isCash(a, opts) {
    if (a.type !== 'Asset') return false;
    const codes = (opts && opts.bankCodes) || [];
    if (codes.includes(String(a.code))) return true;
    return RE_CASH.test(nm(a)) && !/receivable|reserve requirement/i.test(nm(a));
  }

  /** Cash-flow bucket for a balance-sheet account. */
  function cashFlowRole(a, opts) {
    opts = opts || {};
    const n = nm(a);
    if (a.type === 'Asset') {
      if (isCash(a, opts)) return { role: 'cash' };
      if (RE_ACCUM.test(n)) return { role: 'noncash_adjustment', label: 'Depreciation, amortisation and impairment (non-cash)' };
      if (/(interest|dividend) receivable/i.test(n)) return { role: 'investing_income_accrual' };
      if (/loans? receivable/i.test(n)) return opts.financialBusiness ? { role: 'operating', label: 'Loans and advances to customers' } : { role: 'investing', label: n };
      if (/receivable|debtor|retention|advance/i.test(n)) return { role: 'operating', label: 'Trade and other receivables' };
      if (/inventory|stock|work.?in.?progress|finished goods|raw material/i.test(n)) return { role: 'operating', label: 'Inventories' };
      if (/prepa/i.test(n)) return { role: 'operating', label: 'Prepayments and other current assets' };
      if (bsClass(a, opts) === 'non_current') return { role: 'investing', label: n };
      return { role: 'operating', label: 'Prepayments and other current assets' };
    }
    if (a.type === 'Liability') {
      if (/interest payable|accrued interest/i.test(n)) return { role: 'interest_accrual' };
      if (RE_INCOME_TAX.test(n) && /payable|provision|liab/i.test(n)) return { role: 'income_tax_accrual' };
      if (RE_FINANCING_LIAB.test(n) && !/payable to (supplier|vendor)/i.test(n)) return { role: 'financing', label: n };
      if (RE_STATUTORY.test(n)) return { role: 'operating', label: 'Taxes and statutory deductions payable (VAT, PAYE, pension, WHT)' };
      return { role: 'operating', label: 'Trade and other payables' };
    }
    if (a.type === 'Equity') {
      return { role: 'financing', label: isDrawings(a) ? 'Drawings / distributions to owners' : (/retained|reserve/i.test(n) ? 'Other movements in retained earnings and reserves' : 'Proceeds from owners’ capital contributions') };
    }
    return { role: 'operating', label: n };
  }

  // ───────────────────────── ledger arithmetic ─────────────────────────

  /** Movement of one account over [from, to] (inclusive; either bound may be null),
   *  in the account's natural sign. `closing` entries are ignored: they only move
   *  profit between P&L accounts and Retained Earnings and would double-count. */
  function buildMovementIndex(entries) {
    const idx = {};
    (entries || []).forEach((je) => {
      if (!je || je.type === 'closing') return;
      const d = day(je.date);
      (je.lines || []).forEach((l) => {
        const k = String(l.accountCode);
        (idx[k] = idx[k] || []).push({ d, dr: l.type === 'debit' ? Number(l.amount) || 0 : 0, cr: l.type === 'credit' ? Number(l.amount) || 0 : 0 });
      });
    });
    return idx;
  }

  function movement(a, idx, from, to) {
    const rows = idx[String(a.code)] || [];
    let dr = 0, cr = 0;
    rows.forEach((r) => {
      if (from && r.d < from) return;
      if (to && r.d > to) return;
      dr += r.dr; cr += r.cr;
    });
    return r2(isDebitNormal(a) ? dr - cr : cr - dr);
  }

  /** Balance of a Balance-Sheet account as at `asOf` (inclusive): opening + movements. */
  function balanceAt(a, idx, openingBalances, asOf) {
    const ob = Number((openingBalances || {})[a.code]) || 0;
    return r2(ob + movement(a, idx, null, asOf));
  }

  function dayBefore(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  // ───────────────────────── statement of profit or loss ─────────────────────────

  function statementOfProfitOrLoss(accounts, entries, period, opts) {
    opts = opts || {};
    const idx = opts._idx || buildMovementIndex(entries);
    const from = period.from || null, to = period.to || null;
    const pl = (accounts || []).filter((a) => a.type === 'Revenue' || a.type === 'Expense');
    const rows = pl.map((a) => {
      const amount = movement(a, idx, from, to);
      const c = classifyCategory(a, opts);
      return { code: a.code, name: a.name, type: a.type, amount, category: c.category, source: c.source,
               line: classifyFunction(a), nature: a.type === 'Expense' ? classifyNature(a) : null };
    }).filter((r) => Math.abs(r.amount) >= 0.005);

    const inCat = (cat) => rows.filter((r) => r.category === cat);
    const op = inCat('operating'), inv = inCat('investing'), fin = inCat('financing'), tax = inCat('income_tax'), disc = inCat('discontinued');
    const signed = (r) => (r.type === 'Revenue' ? r.amount : -r.amount); // effect on profit
    const net = (list) => sum(list, signed);
    const byLine = (l) => op.filter((r) => r.line === l);

    const revenue = byLine('revenue'), otherInc = byLine('other_operating_income');
    const cos = byLine('cost_of_sales'), sd = byLine('selling_distribution'), adm = byLine('administrative'), oth = byLine('other_operating');
    const totalRevenue = sum(revenue, (r) => r.amount);
    const totalCos = sum(cos, (r) => r.amount);
    const operatingProfit = net(op);
    const investingNet = net(inv);
    const profitBeforeFinancingAndTax = r2(operatingProfit + investingNet);
    const financingNet = net(fin);
    const profitBeforeTax = r2(profitBeforeFinancingAndTax + financingNet);
    const taxExpense = sum(tax, (r) => r.amount);
    const profitContinuing = r2(profitBeforeTax - taxExpense);
    const discontinuedNet = net(disc);
    const profitForPeriod = r2(profitContinuing + discontinuedNet);

    // by-nature note (mandatory when presenting by function): ALL operating expenses
    const natureTotals = { materials_goods: 0, employee_benefits: 0, depreciation_amortisation: 0, impairment_writedown: 0, other: 0 };
    const natureLines = {};
    op.filter((r) => r.type === 'Expense').forEach((r) => {
      natureTotals[r.nature] = r2(natureTotals[r.nature] + r.amount);
      (natureLines[r.nature] = natureLines[r.nature] || []).push({ code: r.code, name: r.name, amount: r.amount });
    });
    const totalOperatingExpenses = sum(Object.values(natureTotals));

    // MPM note: EBITDA as the worked example of a management-defined performance measure
    const da = natureTotals.depreciation_amortisation;
    const taxRate = Number(opts.mpmTaxRate) || 0;
    const mpms = [{
      name: 'EBITDA (Earnings before interest, tax, depreciation and amortisation)',
      definition: 'Operating profit plus depreciation, amortisation and depletion.',
      comparable: 'Operating profit',
      comparableAmount: operatingProfit,
      reconciliation: [{ label: 'Depreciation, amortisation and depletion', amount: da, taxEffect: r2(-da * taxRate), nciEffect: 0 }],
      amount: r2(operatingProfit + da),
      taxRateAssumed: taxRate,
      usefulness: 'Shows operating performance before the effect of capital intensity and asset ages.'
    }];

    const warnings = [];
    rows.filter((r) => r.source === 'auto' && r.category !== 'operating').forEach((r) => {
      warnings.push(`"${r.name}" was classified into the ${r.category.replace('_', ' ')} category from its name. Confirm or change it under Classification.`);
    });
    if (!rows.some((r) => r.category === 'income_tax') && profitBeforeTax > 0) {
      warnings.push('No income tax expense account has activity in this period. If tax is payable on this profit, post it to an "Income Tax Expense" account so it appears in the Income taxes category.');
    }

    return {
      period: { from, to },
      rows,
      revenue: { lines: revenue, total: totalRevenue },
      costOfSales: { lines: cos, total: totalCos },
      grossProfit: r2(totalRevenue - totalCos),
      otherOperatingIncome: { lines: otherInc, total: sum(otherInc, (r) => r.amount) },
      sellingDistribution: { lines: sd, total: sum(sd, (r) => r.amount) },
      administrative: { lines: adm, total: sum(adm, (r) => r.amount) },
      otherOperating: { lines: oth, total: sum(oth, (r) => r.amount) },
      operatingProfit,
      investing: { lines: inv, net: investingNet },
      profitBeforeFinancingAndTax,
      financing: { lines: fin, net: financingNet },
      profitBeforeTax,
      incomeTax: { lines: tax, total: taxExpense },
      profitFromContinuingOperations: profitContinuing,
      discontinued: { lines: disc, net: discontinuedNet },
      profitForPeriod,
      byNature: { totals: natureTotals, lines: natureLines, total: totalOperatingExpenses, labels: NATURE_LABELS },
      functionLabels: FUNCTION_LABELS,
      mpms,
      warnings
    };
  }

  // ───────────────────────── statement of cash flows ─────────────────────────

  function statementOfCashFlows(accounts, entries, period, opts) {
    opts = opts || {};
    const idx = buildMovementIndex(entries);
    const from = period.from, to = period.to;
    const openDate = from ? dayBefore(from) : null;
    const ob = opts.openingBalances || {};
    const pl = statementOfProfitOrLoss(accounts, entries, period, Object.assign({}, opts, { _idx: idx }));

    const bs = (accounts || []).filter((a) => a.type === 'Asset' || a.type === 'Liability' || a.type === 'Equity');
    const open = (a) => (openDate ? balanceAt(a, idx, ob, openDate) : (Number(ob[a.code]) || 0));
    const close = (a) => balanceAt(a, idx, ob, to);

    // cash effect of an account's change: assets (and drawings) absorb cash when they grow
    const effect = (a) => {
      const d = r2(close(a) - open(a));
      return isDebitNormal(a) ? -d : d;
    };

    const groups = {}; // key -> {label, amount}
    const add = (bucket, label, amt) => {
      if (Math.abs(amt) < 0.005) return;
      const k = bucket + '|' + label;
      groups[k] = groups[k] || { bucket, label, amount: 0 };
      groups[k].amount = r2(groups[k].amount + amt);
    };

    let cashOpen = 0, cashClose = 0, interestAccrual = 0, taxAccrual = 0, invIncomeAccrual = 0;
    bs.forEach((a) => {
      const role = cashFlowRole(a, opts);
      if (role.role === 'cash') { cashOpen += open(a); cashClose += close(a); return; }
      const e = effect(a);
      if (role.role === 'interest_accrual') interestAccrual += e;
      else if (role.role === 'income_tax_accrual') taxAccrual += e;
      else if (role.role === 'investing_income_accrual') invIncomeAccrual += e;
      else if (role.role === 'noncash_adjustment') add('adjustment', role.label, e);
      else if (role.role === 'operating') add('working_capital', role.label, e);
      else if (role.role === 'investing') add('investing', role.label, e);
      else if (role.role === 'financing') add('financing', role.label, e);
    });
    cashOpen = r2(cashOpen); cashClose = r2(cashClose);

    const pick = (bucket) => Object.values(groups).filter((g) => g.bucket === bucket);
    const adjustments = pick('adjustment');
    const workingCapital = pick('working_capital');
    const operatingProfit = pl.operatingProfit;
    const cashGeneratedFromOperations = r2(operatingProfit + sum(adjustments, (g) => g.amount) + sum(workingCapital, (g) => g.amount));

    // income taxes paid: expense adjusted for the movement in income-tax payable (operating)
    const incomeTaxPaid = r2(-pl.incomeTax.total + taxAccrual);
    // discontinued operations: shown after tax as one line inside operating
    const discontinued = pl.discontinued.net;
    const netOperating = r2(cashGeneratedFromOperations + incomeTaxPaid + discontinued);

    // investing: capex/investments + interest and dividends received (IFRS 18 amendment to IAS 7)
    const investingItems = pick('investing');
    const investingReceived = r2(pl.investing.net + invIncomeAccrual);
    const netInvesting = r2(sum(investingItems, (g) => g.amount) + investingReceived);

    // financing: borrowings, owners’ capital/drawings, interest paid (IFRS 18 amendment to IAS 7)
    const financingItems = pick('financing');
    const interestPaid = r2(pl.financing.net + interestAccrual); // pl.financing.net is already negative for a cost
    const netFinancing = r2(sum(financingItems, (g) => g.amount) + interestPaid);

    const netChange = r2(netOperating + netInvesting + netFinancing);
    const computedClose = r2(cashOpen + netChange);
    const difference = r2(cashClose - computedClose);

    return {
      period, openingCash: cashOpen, closingCash: cashClose,
      operatingProfit, adjustments, workingCapital, cashGeneratedFromOperations,
      incomeTaxPaid, discontinued, netOperating,
      investingItems, interestAndDividendsReceived: investingReceived, netInvesting,
      financingItems, interestPaid, netFinancing,
      netChange, computedClosingCash: computedClose, unreconciledDifference: difference,
      reconciled: Math.abs(difference) < 0.01
    };
  }

  // ───────────────────────── statement of financial position ─────────────────────────

  function statementOfFinancialPosition(accounts, entries, asOf, opts) {
    opts = opts || {};
    // include closing entries here: they only move profit into retained earnings
    const idx = {};
    (entries || []).forEach((je) => {
      const d = day(je.date);
      (je.lines || []).forEach((l) => {
        const k = String(l.accountCode);
        (idx[k] = idx[k] || []).push({ d, dr: l.type === 'debit' ? Number(l.amount) || 0 : 0, cr: l.type === 'credit' ? Number(l.amount) || 0 : 0 });
      });
    });
    const ob = opts.openingBalances || {};
    const bal = (a) => balanceAt(a, idx, ob, asOf);
    const line = (a) => ({ code: a.code, name: a.name, amount: bal(a) });
    const nonZero = (l) => Math.abs(l.amount) >= 0.005;

    const assets = (accounts || []).filter((a) => a.type === 'Asset');
    const liabs = (accounts || []).filter((a) => a.type === 'Liability');
    const equity = (accounts || []).filter((a) => a.type === 'Equity');

    const curA = assets.filter((a) => bsClass(a, opts) === 'current').map(line).filter(nonZero);
    const ncA = assets.filter((a) => bsClass(a, opts) === 'non_current').map(line).filter(nonZero);
    const curL = liabs.filter((a) => bsClass(a, opts) === 'current').map(line).filter(nonZero);
    const ncL = liabs.filter((a) => bsClass(a, opts) === 'non_current').map(line).filter(nonZero);

    // profit not yet closed into retained earnings
    let unclosed = 0;
    (accounts || []).filter((a) => a.type === 'Revenue' || a.type === 'Expense').forEach((a) => {
      const m = movement(a, idx, null, asOf);
      unclosed += a.type === 'Revenue' ? m : -m;
    });
    const eqLines = equity.map((a) => {
      const l = line(a);
      return isDrawings(a) ? { code: a.code, name: a.name + ' (contra)', amount: -l.amount } : l;
    }).filter(nonZero);
    const retainedCurrent = r2(unclosed);

    const totalCA = sum(curA, (l) => l.amount), totalNCA = sum(ncA, (l) => l.amount);
    const totalCL = sum(curL, (l) => l.amount), totalNCL = sum(ncL, (l) => l.amount);
    const totalEquity = r2(sum(eqLines, (l) => l.amount) + retainedCurrent);
    const totalAssets = r2(totalCA + totalNCA);
    const totalLiabilities = r2(totalCL + totalNCL);

    return {
      asOf,
      currentAssets: { lines: curA, total: totalCA },
      nonCurrentAssets: { lines: ncA, total: totalNCA },
      totalAssets,
      currentLiabilities: { lines: curL, total: totalCL },
      nonCurrentLiabilities: { lines: ncL, total: totalNCL },
      totalLiabilities,
      equity: { lines: eqLines, profitNotYetClosed: retainedCurrent, total: totalEquity },
      totalEquityAndLiabilities: r2(totalLiabilities + totalEquity),
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      difference: r2(totalAssets - (totalLiabilities + totalEquity))
    };
  }

  // ───────────────────────── ledger integrity audit ─────────────────────────

  function integrityChecks(accounts, entries, openingBalances, asOf) {
    const findings = [];
    const codes = new Set((accounts || []).map((a) => String(a.code)));
    (entries || []).forEach((je) => {
      const lines = je.lines || [];
      const dr = sum(lines.filter((l) => l.type === 'debit'), (l) => Number(l.amount) || 0);
      const cr = sum(lines.filter((l) => l.type === 'credit'), (l) => Number(l.amount) || 0);
      if (Math.abs(dr - cr) >= 0.01) findings.push({ severity: 'high', check: 'unbalanced_journal', detail: `Journal "${je.description || je.id || je._id}" (${day(je.date)}) debits ${dr} ≠ credits ${cr}.` });
      lines.forEach((l) => { if (!codes.has(String(l.accountCode))) findings.push({ severity: 'high', check: 'unknown_account', detail: `Journal "${je.description || je.id || je._id}" posts to account ${l.accountCode}, which is not in the Chart of Accounts.` }); });
      if (lines.some((l) => !(Number(l.amount) >= 0))) findings.push({ severity: 'medium', check: 'negative_amount', detail: `Journal "${je.description || je.id || je._id}" has a negative or non-numeric line amount.` });
    });
    const idx = {};
    (entries || []).forEach((je) => {
      const d = day(je.date);
      (je.lines || []).forEach((l) => {
        const k = String(l.accountCode);
        (idx[k] = idx[k] || []).push({ d, dr: l.type === 'debit' ? Number(l.amount) || 0 : 0, cr: l.type === 'credit' ? Number(l.amount) || 0 : 0 });
      });
    });
    (accounts || []).forEach((a) => {
      const recomputed = balanceAt(a, idx, openingBalances, asOf || '9999-12-31');
      const stored = r2(a.balance);
      if (Math.abs(recomputed - stored) >= 0.01) {
        findings.push({ severity: 'high', check: 'balance_drift', detail: `${a.code} ${a.name}: stored balance ${stored} but opening balance + journals = ${recomputed} (difference ${r2(stored - recomputed)}).` });
      }
    });
    return findings;
  }

  return {
    CATEGORIES, FUNCTION_LINES, FUNCTION_LABELS, NATURE_LABELS,
    classifyCategory, classifyFunction, classifyNature, bsClass, cashFlowRole, isCash, isDrawings, isDebitNormal,
    buildMovementIndex, movement, balanceAt,
    statementOfProfitOrLoss, statementOfCashFlows, statementOfFinancialPosition, integrityChecks
  };
});
