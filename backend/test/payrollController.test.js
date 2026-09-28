'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createDB, seedAccount, loadController, mockReqRes } = require('./helpers/mockModels');

function setupCompany(db) {
  seedAccount(db, { code: '6000', name: 'Salary Expense', type: 'Expense' });
  seedAccount(db, { code: '1000', name: 'Cash and Bank', type: 'Asset' });
  seedAccount(db, { code: '2200', name: 'PAYE Payable', type: 'Liability' });
  seedAccount(db, { code: '2300', name: 'Pension Payable', type: 'Liability' });
  const BankAccount = db.models['../models/BankAccount'];
  const bank = new BankAccount({ companyId: 'co1', name: 'Main Account', bank: 'GTBank', code: '1000', openingBalance: 0 });
  db.bankAccounts.push(bank);
  const Employee = db.models['../models/Employee'];
  const emp = new Employee({ companyId: 'co1', name: 'Amina Yusuf', annualSalary: 3600000, annualRent: 0 });
  db.employees.push(emp);
  return { bank, emp };
}

describe('payrollController — Banking module sync', () => {
  test('THE GAP: recordSinglePayroll must create a BankTransaction, not just move the GL balance', async () => {
    const db = createDB();
    const { emp } = setupCompany(db);
    const ctl = loadController('controllers/payrollController.js', db);

    const { req, res } = mockReqRes({
      employeeId: emp._id, date: '2026-09-27',
      monthlyGross: 300000, monthlyNet: 250000, monthlyPAYE: 30000, monthlyPension: 20000
    });
    await ctl.recordSinglePayroll(req, res);

    assert.equal(res.statusCode, 200);
    const ledgerCash = db.accounts.find(a => a.code === '1000').balance;
    assert.equal(ledgerCash, -250000, 'ledger cash account must reflect the net payment');

    assert.equal(db.bankTransactions.length, 1, 'a BankTransaction must be created — this is the actual bug being tested');
    const tx = db.bankTransactions[0];
    assert.equal(tx.amount, 250000);
    assert.equal(tx.type, 'debit');

    const bankingModuleBalance = 0 /* opening balance */ - db.bankTransactions
      .filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0)
      + db.bankTransactions.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    assert.equal(bankingModuleBalance, ledgerCash, 'Banking module balance must match the ledger after payroll');
  });

  test('runBatchPayroll must also create a BankTransaction for the whole run', async () => {
    const db = createDB();
    setupCompany(db);
    const Employee = db.models['../models/Employee'];
    db.employees.push(new Employee({ companyId: 'co1', name: 'Second Employee', annualSalary: 2400000, annualRent: 0 }));
    const ctl = loadController('controllers/payrollController.js', db);

    const { req, res } = mockReqRes({ month: 9, year: 2026 });
    await ctl.runBatchPayroll(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(db.bankTransactions.length, 1, 'one summary BankTransaction for the batch run');
    const ledgerCash = db.accounts.find(a => a.code === '1000').balance;
    assert.equal(db.bankTransactions[0].amount, -ledgerCash, 'the transaction amount must equal what left the ledger cash account');
  });

  test('an explicit bankCode routes payroll through the chosen bank account instead of the default', async () => {
    const db = createDB();
    const { emp } = setupCompany(db);
    seedAccount(db, { code: '1010', name: 'Second Bank', type: 'Asset' });
    const BankAccount = db.models['../models/BankAccount'];
    db.bankAccounts.push(new BankAccount({ companyId: 'co1', name: 'Payroll Account', bank: 'Zenith', code: '1010', openingBalance: 0 }));
    const ctl = loadController('controllers/payrollController.js', db);

    const { req, res } = mockReqRes({
      employeeId: emp._id, date: '2026-09-27', bankCode: '1010',
      monthlyGross: 300000, monthlyNet: 250000, monthlyPAYE: 30000, monthlyPension: 20000
    });
    await ctl.recordSinglePayroll(req, res);

    assert.equal(db.accounts.find(a => a.code === '1000').balance, 0, 'the default cash account must be untouched');
    assert.equal(db.accounts.find(a => a.code === '1010').balance, -250000);
    assert.equal(db.bankTransactions[0].bankAccountCode, '1010');
  });
});
