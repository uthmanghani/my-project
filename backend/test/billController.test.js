'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createDB, seedAccount, loadController, mockReqRes } = require('./helpers/mockModels');

function setupCompany(db) {
  seedAccount(db, { code: '5200', name: 'Purchases', type: 'Expense' });
  seedAccount(db, { code: '1200', name: 'Merchandise Inventory', type: 'Asset' });
  seedAccount(db, { code: '2000', name: 'Accounts Payable', type: 'Liability' });
  const Product = db.models['../models/Product'];
  const product = new Product({ companyId: 'co1', name: 'Rice', stock: 10, cost: 100 });
  db.products.push(product);
  return product;
}

describe('billController.create — stock updates', () => {
  test('THE ORIGINAL BUG: a product line posted to a plain EXPENSE account must still update stock', async () => {
    const db = createDB();
    const product = setupCompany(db);
    const ctl = loadController('controllers/billController.js', db);

    const { req, res } = mockReqRes({
      vendorId: 'v1', date: '2026-09-25', whtRate: 0, expenseAccount: '5200', total: 1000,
      lines: [{ productId: product._id, quantity: 5, rate: 200, amount: 1000 }]
    });
    await ctl.create(req, res);

    assert.equal(res.statusCode, 201, 'bill creation should succeed');
    assert.equal(product.stock, 15, 'stock must increase even when the account is a plain Expense account');
    assert.equal(Math.round(product.cost * 100) / 100, 133.33, 'weighted-average cost must recompute');
    assert.equal(res.body.isInventoryPurchase, true);
  });

  test('a product line posted to an inventory-named account also updates stock (unchanged behavior)', async () => {
    const db = createDB();
    const product = setupCompany(db);
    const ctl = loadController('controllers/billController.js', db);

    const { req, res } = mockReqRes({
      vendorId: 'v1', date: '2026-09-25', whtRate: 0, expenseAccount: '1200', total: 1000,
      lines: [{ productId: product._id, quantity: 5, rate: 200, amount: 1000 }]
    });
    await ctl.create(req, res);

    assert.equal(product.stock, 15);
  });

  test('a bill with no product lines never touches stock', async () => {
    const db = createDB();
    const product = setupCompany(db);
    const ctl = loadController('controllers/billController.js', db);

    const { req, res } = mockReqRes({
      vendorId: 'v1', date: '2026-09-25', whtRate: 0, expenseAccount: '5200', total: 500,
      lines: [{ description: 'Stationery', quantity: 1, rate: 500, amount: 500 }]
    });
    await ctl.create(req, res);

    assert.equal(product.stock, 10, 'stock must be untouched when no line names a product');
    assert.equal(res.body.isInventoryPurchase, false);
  });
});

describe('billController — cross-tenant access (IDOR)', () => {
  test('recordPayment 404s when the bill belongs to a different company', async () => {
    const db = createDB();
    setupCompany(db);
    const Bill = db.models['../models/Bill'];
    const bill = new Bill({ companyId: 'co1', status: 'unpaid', total: 1000, balance: 1000 });
    db.bills.push(bill);
    const ctl = loadController('controllers/billController.js', db);

    const { req, res } = mockReqRes({ amount: 100 }, { id: bill._id }, { companyId: 'ATTACKER_CO', role: 'admin' });
    await ctl.recordPayment(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Bill not found');
  });
});

describe('billController — AppError vs internal error handling', () => {
  test('a business-rule violation (already-paid bill) returns its exact message and a 400', async () => {
    const db = createDB();
    setupCompany(db);
    const Bill = db.models['../models/Bill'];
    const bill = new Bill({ companyId: 'co1', status: 'paid', total: 1000, balance: 0 });
    db.bills.push(bill);
    const ctl = loadController('controllers/billController.js', db);

    const { req, res } = mockReqRes({ amount: 100 }, { id: bill._id }, { companyId: 'co1', role: 'admin' });
    await ctl.recordPayment(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Bill already fully paid');
  });

  test('a genuine internal error never leaks its raw message to the client', async () => {
    const db = createDB();
    setupCompany(db);
    const ctl = loadController('controllers/billController.js', db);
    // Force a real, unexpected exception from inside the model layer.
    db.models['../models/Bill'].findOne = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'session')");
    };

    const originalConsoleError = console.error;
    let loggedServerSide = null;
    console.error = (e) => { loggedServerSide = e; };
    const { req, res } = mockReqRes({ amount: 100 }, { id: 'whatever' }, { companyId: 'co1', role: 'admin' });
    try {
      await ctl.recordPayment(req, res);
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'Something went wrong. Please try again.');
    assert.ok(loggedServerSide, 'the real error must still be logged server-side for debugging');
    assert.match(String(loggedServerSide.message || loggedServerSide), /Cannot read properties/);
  });
});
