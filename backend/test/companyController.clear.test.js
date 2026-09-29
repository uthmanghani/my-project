'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createDB, seedAccount, loadController, mockReqRes } = require('./helpers/mockModels');
const INDUSTRIES = require(path.join(__dirname, '..', 'utils', 'industryData.js'));

// A company on a real industry template, plus every kind of leftover the
// "Clear company data" action has to make a decision about.
function setup(industry = 'trading') {
  const db = createDB();
  db.company.industry = industry;
  const BankAccount = db.models['../models/BankAccount'];

  // The company's own chart of accounts, straight from its template.
  const template = INDUSTRIES.find(i => i.id === industry);
  for (const a of template.accounts) seedAccount(db, { code: a.code, name: a.name, type: a.type, balance: 100 });

  // The four accounts from the bug report: bank ledger accounts still in the
  // Chart of Accounts after a clear. Deactivated (removed from the chart),
  // no BankAccount record left, and none of these codes is in the trading
  // template. 1050 and 1500 ARE template codes -- but only in other
  // industries -- and 1095 is not a multiple of 10.
  const orphans = [
    ['1020', 'Zenith Bank Savings Account - Uthman Ghani'],
    ['1050', 'First Bank Current - First-BanK Acct'],
    ['1095', 'OPAY Account'],
    ['1500', 'Moniepoint - Moniepoint Wallet'],
  ];
  for (const [code, name] of orphans) seedAccount(db, { code, name, type: 'Asset' }).isActive = false;

  // A live bank account, and one deleted through the Banking module (which
  // only deactivates) -- both still have a BankAccount record pointing at them.
  seedAccount(db, { code: '1510', name: 'GTBank - Main', type: 'Asset', balance: 1000 });
  db.bankAccounts.push(new BankAccount({ companyId: 'co1', name: 'Main', bank: 'GTBank', code: '1510', isActive: true }));
  seedAccount(db, { code: '1520', name: 'Zenith - Payroll', type: 'Asset' }).isActive = false;
  db.bankAccounts.push(new BankAccount({ companyId: 'co1', name: 'Payroll', bank: 'Zenith', code: '1520', isActive: false }));

  return { db, template, orphanCodes: orphans.map(o => o[0]) };
}

async function clear(db) {
  const ctl = loadController('controllers/companyController.js', db);
  const { req, res } = mockReqRes();
  await ctl.clearCompanyData(req, res);
  return res;
}
const codesLeft = (db) => db.accounts.map(a => a.code);

describe('companyController.clearCompanyData — bank ledger accounts', () => {
  test('THE REPORTED BUG: the four leftover bank accounts from the screenshot are removed', async () => {
    const { db, orphanCodes } = setup();
    const res = await clear(db);
    assert.equal(res.statusCode, 200);
    for (const code of orphanCodes) assert.ok(!codesLeft(db).includes(code), `${code} must be removed`);
  });

  test('removes the ledger account of every bank account that still has a record, live or deactivated', async () => {
    const { db } = setup();
    await clear(db);
    assert.ok(!codesLeft(db).includes('1510'), 'live bank ledger account must be removed');
    assert.ok(!codesLeft(db).includes('1520'), 'deactivated bank ledger account must be removed');
  });

  test("leaves exactly the company's own template chart behind, with balances zeroed", async () => {
    const { db, template } = setup();
    await clear(db);
    assert.deepEqual(codesLeft(db).sort(), template.accounts.map(a => a.code).sort());
    assert.ok(db.accounts.every(a => a.balance === 0 && a.openingBalance === 0), 'balances must be reset');
  });

  test("a code that is another industry's template account is NOT protected for this company", async () => {
    // 1050 is Central Bank Reserve in the fintech template, but this is a trading company.
    const { db } = setup('trading');
    await clear(db);
    assert.ok(!codesLeft(db).includes('1050'));
  });

  test("but the company's OWN template accounts survive even if deactivated by hand", async () => {
    // 1050 is Central Bank Reserve in the fintech template: for a fintech
    // company it IS part of the chart, so a clear must keep it.
    const db = createDB();
    db.company.industry = 'fintech';
    for (const a of INDUSTRIES.find(i => i.id === 'fintech').accounts) {
      seedAccount(db, { code: a.code, name: a.name, type: a.type });
    }
    db.accounts.find(a => a.code === '1050').isActive = false;
    await clear(db);
    assert.ok(codesLeft(db).includes('1050'), 'own-template 1050 must survive');
  });

  test('never removes an ACTIVE account, or a deactivated account that is not an Asset', async () => {
    const { db } = setup();
    seedAccount(db, { code: '1530', name: 'Custom Prepayments', type: 'Asset' }); // active custom
    seedAccount(db, { code: '6999', name: 'Old Expense', type: 'Expense' }).isActive = false;
    await clear(db);
    assert.ok(codesLeft(db).includes('1530'), 'an active custom Asset account must survive');
    assert.ok(codesLeft(db).includes('6999'), 'a deactivated non-Asset account is out of scope');
  });

  test('if the industry cannot be identified, it errs on the side of removing less', async () => {
    const { db } = setup();
    db.company.industry = 'something-unrecognised';
    await clear(db);
    const left = codesLeft(db);
    // 1050 and 1500 are template codes somewhere, so they are kept...
    assert.ok(left.includes('1050') && left.includes('1500'));
    // ...but codes no template uses are still removed.
    assert.ok(!left.includes('1020') && !left.includes('1095'));
  });

  test('only ever touches the calling company', async () => {
    const { db } = setup();
    seedAccount(db, { code: '1095', name: 'Other Co OPAY', type: 'Asset', companyId: 'OTHER' }).isActive = false;
    await clear(db);
    assert.ok(db.accounts.some(a => a.companyId === 'OTHER' && a.code === '1095'));
  });

  test('reports how many bank ledger accounts were removed', async () => {
    const { db } = setup();
    const res = await clear(db);
    assert.equal(res.body.bankLedgerAccountsRemoved, 6, 'the 4 orphans plus 1510 and 1520');
  });
});
