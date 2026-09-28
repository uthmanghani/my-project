'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createDB, seedAccount, loadController, mockReqRes } = require('./helpers/mockModels');

function setupCompany(db) {
  seedAccount(db, { code: '1100', name: 'Accounts Receivable', type: 'Asset' });
  seedAccount(db, { code: '4000', name: 'Revenue', type: 'Revenue' });
  seedAccount(db, { code: '2000', name: 'Accounts Payable', type: 'Liability' });
  seedAccount(db, { code: '6000', name: 'General Expense', type: 'Expense' });
}

describe('recurringBillingController', () => {
  test('an invoice-type schedule generates a real invoice through invoiceController and advances nextDate', async () => {
    const db = createDB();
    setupCompany(db);
    const ctl = loadController('controllers/recurringBillingController.js', db);

    const { req: r1, res: res1 } = mockReqRes({
      name: 'Monthly Retainer', type: 'invoice', entityId: 'cust1', amount: 50000,
      frequency: 'monthly', nextDate: '2026-09-25'
    });
    await ctl.create(r1, res1);
    assert.equal(res1.statusCode, 201);
    const rbId = res1.body._id;

    const { req: r2, res: res2 } = mockReqRes({}, { id: rbId });
    await ctl.run(r2, res2);

    assert.equal(res2.statusCode, 200);
    assert.equal(db.invoices.length, 1, 'a real invoice must be created');
    assert.equal(db.invoices[0].total, 50000);
    assert.equal(db.accounts.find(a => a.code === '1100').balance, 50000, 'AR must reflect the generated invoice');
    assert.equal(
      new Date(res2.body.schedule.nextDate).toISOString().slice(0, 10),
      '2026-10-25',
      'nextDate must advance by exactly one month'
    );
  });

  test('a bill-type schedule generates a real bill through billController', async () => {
    const db = createDB();
    setupCompany(db);
    const ctl = loadController('controllers/recurringBillingController.js', db);

    const { req: r1, res: res1 } = mockReqRes({
      name: 'Monthly Rent', type: 'bill', entityId: 'vend1', amount: 120000,
      frequency: 'monthly', nextDate: '2026-09-25', expenseAccount: '6000'
    });
    await ctl.create(r1, res1);
    const rbId = res1.body._id;

    const { req: r2, res: res2 } = mockReqRes({}, { id: rbId });
    await ctl.run(r2, res2);

    assert.equal(db.bills.length, 1);
    assert.equal(db.bills[0].total, 120000);
    assert.equal(db.accounts.find(a => a.code === '2000').balance, 120000);
  });

  test('a paused schedule cannot be run', async () => {
    const db = createDB();
    setupCompany(db);
    const ctl = loadController('controllers/recurringBillingController.js', db);

    const { req: r1, res: res1 } = mockReqRes({
      name: 'Paused One', type: 'bill', entityId: 'vend1', amount: 1000,
      frequency: 'monthly', nextDate: '2026-09-25', expenseAccount: '6000'
    });
    await ctl.create(r1, res1);
    const rbId = res1.body._id;
    await ctl.update(...Object.values(mockReqRes({ active: false }, { id: rbId })));

    const { req, res } = mockReqRes({}, { id: rbId });
    await ctl.run(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(db.bills.length, 0, 'nothing should be generated while paused');
  });

  test('weekly, quarterly and yearly frequencies advance nextDate correctly', async () => {
    const db = createDB();
    setupCompany(db);
    const ctl = loadController('controllers/recurringBillingController.js', db);

    const cases = [
      { frequency: 'weekly', start: '2026-09-25', expected: '2026-10-02' },
      { frequency: 'quarterly', start: '2026-09-25', expected: '2026-12-25' },
      { frequency: 'yearly', start: '2026-09-25', expected: '2027-09-25' },
    ];
    for (const c of cases) {
      const { req: r1, res: res1 } = mockReqRes({
        name: c.frequency, type: 'bill', entityId: 'vend1', amount: 1000,
        frequency: c.frequency, nextDate: c.start, expenseAccount: '6000'
      });
      await ctl.create(r1, res1);
      const { req: r2, res: res2 } = mockReqRes({}, { id: res1.body._id });
      await ctl.run(r2, res2);
      assert.equal(
        new Date(res2.body.schedule.nextDate).toISOString().slice(0, 10),
        c.expected,
        `${c.frequency} should advance from ${c.start} to ${c.expected}`
      );
    }
  });

  test('cross-tenant access is rejected (IDOR)', async () => {
    const db = createDB();
    setupCompany(db);
    const ctl = loadController('controllers/recurringBillingController.js', db);
    const { req: r1, res: res1 } = mockReqRes({
      name: 'x', type: 'bill', entityId: 'vend1', amount: 1000, frequency: 'monthly', nextDate: '2026-09-25'
    });
    await ctl.create(r1, res1);

    const { req, res } = mockReqRes({}, { id: res1.body._id }, { companyId: 'ATTACKER_CO', role: 'admin' });
    await ctl.run(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(db.bills.length, 0);
  });
});
