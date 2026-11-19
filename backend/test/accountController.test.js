'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createDB, seedAccount, loadController, mockReqRes } = require('./helpers/mockModels');

describe('accountController', () => {
  test('changing an opening balance shifts the running balance instead of erasing journal movements', async () => {
    const db = createDB();
    const acc = seedAccount(db, { code: '1000', name: 'Cash', type: 'Asset', balance: 1500 }); // 1000 opening + 500 posted
    acc.openingBalance = 1000;
    const ctl = loadController('controllers/accountController.js', db);
    const { req, res } = mockReqRes({ code: '1000', openingBalance: 1200 });
    await ctl.updateOpeningBalance(req, res);
    assert.equal(acc.openingBalance, 1200);
    assert.equal(acc.balance, 1700); // 500 of movement preserved
  });

  test('classification: rejects unknown categories and wrong account types, accepts a valid override', async () => {
    const db = createDB();
    const exp = seedAccount(db, { code: '6000', name: 'Salaries', type: 'Expense' });
    const asset = seedAccount(db, { code: '1000', name: 'Cash', type: 'Asset' });
    const ctl = loadController('controllers/accountController.js', db);

    let r = mockReqRes({ ifrs18Category: 'bogus' }, { id: exp._id });
    await ctl.updateClassification(r.req, r.res);
    assert.equal(r.res.statusCode, 400);

    r = mockReqRes({ ifrs18Category: 'financing' }, { id: asset._id });
    await ctl.updateClassification(r.req, r.res);
    assert.equal(r.res.statusCode, 400); // P&L categories are not for Asset accounts

    r = mockReqRes({ ifrs18Category: 'financing', ifrs18Line: 'administrative' }, { id: exp._id });
    await ctl.updateClassification(r.req, r.res);
    assert.equal(exp.ifrs18Category, 'financing');
  });
});
