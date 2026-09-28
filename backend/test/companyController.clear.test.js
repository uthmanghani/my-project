'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createDB, seedAccount, loadController, mockReqRes } = require('./helpers/mockModels');

// Builds a company whose Chart of Accounts holds every kind of account the
// "Clear company data" action has to make a decision about.
function setup() {
  const db = createDB();
  const BankAccount = db.models['../models/BankAccount'];

  // Seeded by the industry template -- must survive a clear.
  seedAccount(db, { code: '1000', name: 'Cash & Bank', type: 'Asset', balance: 500 });
  seedAccount(db, { code: '1050', name: 'Central Bank Reserve', type: 'Asset', balance: 100 });
  seedAccount(db, { code: '2000', name: 'Accounts Payable', type: 'Liability', balance: 50 });
  // A custom account the user deactivated by hand -- not a bank account, must survive.
  const custom = seedAccount(db, { code: '6900', name: 'Old Expense', type: 'Expense', balance: 0 });
  custom.isActive = false;

  // 1. An ordinary, live bank account and its ledger account.
  seedAccount(db, { code: '1500', name: 'GTBank - Main', type: 'Asset', balance: 1000 });
  db.bankAccounts.push(new BankAccount({ companyId: 'co1', name: 'Main', bank: 'GTBank', code: '1500', isActive: true }));

  // 2. A bank account deleted through the Banking module (which only
  //    DEACTIVATES both the BankAccount and its ledger account).
  const deactivatedLedger = seedAccount(db, { code: '1510', name: 'Zenith - Payroll', type: 'Asset', balance: 0 });
  deactivatedLedger.isActive = false;
  db.bankAccounts.push(new BankAccount({ companyId: 'co1', name: 'Payroll', bank: 'Zenith', code: '1510', isActive: false }));

  // 3. ORPHANS: ledger accounts whose BankAccount record no longer exists
  //    (left behind by an earlier clear that deleted the BankAccount rows
  //    but only deactivated the ledger accounts). Nothing links them to a
  //    bank account any more, so they can only be recognised by what they
  //    are: inactive Asset accounts in the bank code ranges.
  const orphanNew = seedAccount(db, { code: '1520', name: 'Access - Old', type: 'Asset', balance: 0 });
  orphanNew.isActive = false;
  const orphanLegacy = seedAccount(db, { code: '1020', name: 'UBA - Savings', type: 'Asset', balance: 0 });
  orphanLegacy.isActive = false;

  return db;
}

const codesLeft = (db) => db.accounts.map(a => a.code).sort();

describe('companyController.clearCompanyData — bank ledger accounts', () => {
  test('removes the ledger account of every live bank account', async () => {
    const db = setup();
    const ctl = loadController('controllers/companyController.js', db);
    const { req, res } = mockReqRes();
    await ctl.clearCompanyData(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(!codesLeft(db).includes('1500'), 'live bank ledger account 1500 must be removed');
  });

  test('removes the ledger account of a bank account deleted earlier through the Banking module', async () => {
    const db = setup();
    const ctl = loadController('controllers/companyController.js', db);
    const { req, res } = mockReqRes();
    await ctl.clearCompanyData(req, res);
    assert.ok(!codesLeft(db).includes('1510'), 'deactivated bank ledger account 1510 must be removed');
  });

  test('THE REPORTED BUG: removes orphaned bank ledger accounts that no BankAccount record points at any more', async () => {
    const db = setup();
    const ctl = loadController('controllers/companyController.js', db);
    const { req, res } = mockReqRes();
    await ctl.clearCompanyData(req, res);
    const left = codesLeft(db);
    assert.ok(!left.includes('1520'), 'orphan 1520 must be removed');
    assert.ok(!left.includes('1020'), 'legacy-range orphan 1020 must be removed');
  });

  test('keeps every account that is not a bank ledger account, and zeroes their balances', async () => {
    const db = setup();
    const ctl = loadController('controllers/companyController.js', db);
    const { req, res } = mockReqRes();
    await ctl.clearCompanyData(req, res);
    assert.deepEqual(codesLeft(db), ['1000', '1050', '2000', '6900']);
    assert.ok(db.accounts.every(a => a.balance === 0 && a.openingBalance === 0), 'balances must be reset');
  });

  test('only ever touches the calling company', async () => {
    const db = setup();
    seedAccount(db, { code: '1500', name: 'Other Co Bank', type: 'Asset', companyId: 'OTHER' });
    const ctl = loadController('controllers/companyController.js', db);
    const { req, res } = mockReqRes();
    await ctl.clearCompanyData(req, res);
    assert.ok(db.accounts.some(a => a.companyId === 'OTHER' && a.code === '1500'), 'another company\'s accounts must be untouched');
  });

  test('never sweeps a template-seeded code, even if someone deactivated that account by hand', async () => {
    // 1500 is "Land & Building" in several industry templates -- the same
    // code the bank allocator tries first -- and 1050 is Central Bank Reserve.
    const db = createDB();
    seedAccount(db, { code: '1000', name: 'Cash & Bank', type: 'Asset' });
    seedAccount(db, { code: '1050', name: 'Central Bank Reserve', type: 'Asset' }).isActive = false;
    seedAccount(db, { code: '1500', name: 'Land & Building', type: 'Asset' }).isActive = false;
    const ctl = loadController('controllers/companyController.js', db);
    const { req, res } = mockReqRes();
    await ctl.clearCompanyData(req, res);
    assert.ok(codesLeft(db).includes('1500'), 'template account 1500 must survive');
    assert.ok(codesLeft(db).includes('1050'), 'template account 1050 must survive');
  });

  test('never sweeps an ACTIVE account in the bank code range that no bank account points at', async () => {
    const db = setup();
    seedAccount(db, { code: '1530', name: 'Custom Prepayments', type: 'Asset' }); // active, custom
    const ctl = loadController('controllers/companyController.js', db);
    const { req, res } = mockReqRes();
    await ctl.clearCompanyData(req, res);
    assert.ok(codesLeft(db).includes('1530'), 'an active custom account must survive');
  });

  test('reports how many bank ledger accounts were removed', async () => {
    const db = setup();
    const ctl = loadController('controllers/companyController.js', db);
    const { req, res } = mockReqRes();
    await ctl.clearCompanyData(req, res);
    assert.equal(res.body.bankLedgerAccountsRemoved, 4, '1500, 1510, 1520 and 1020');
  });
});
