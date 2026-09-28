'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createDB, seedAccount, loadController, mockReqRes } = require('./helpers/mockModels');

function setupCompany(db) {
  seedAccount(db, { code: '5200', name: 'Purchases', type: 'Expense' });
  seedAccount(db, { code: '2000', name: 'Accounts Payable', type: 'Liability' });
  const Product = db.models['../models/Product'];
  const product = new Product({ companyId: 'co1', name: 'Rice', stock: 10, cost: 100 });
  db.products.push(product);
  return product;
}

describe('purchaseOrderController', () => {
  test('create → convert to bill: PO is marked converted and stock/AP update via the real bill-posting logic', async () => {
    const db = createDB();
    const product = setupCompany(db);
    const ctl = loadController('controllers/purchaseOrderController.js', db);

    const { req: r1, res: res1 } = mockReqRes({
      vendorId: 'v1', date: '2026-09-25',
      lines: [{ productId: product._id, quantity: 5, rate: 200, amount: 1000 }],
      total: 1000
    });
    await ctl.create(r1, res1);
    assert.equal(res1.statusCode, 201);
    assert.equal(res1.body.status, 'open');
    assert.match(res1.body.number, /^PO-\d{4}-\d{4}$/);
    const poId = res1.body._id;

    const { req: r2, res: res2 } = mockReqRes({ expenseAccount: '5200' }, { id: poId });
    await ctl.convertToBill(r2, res2);

    assert.equal(res2.body.purchaseOrder.status, 'converted');
    assert.ok(res2.body.purchaseOrder.convertedBillId);
    assert.equal(res2.body.bill.total, 1000);
    assert.equal(product.stock, 15, 'converting a PO must update stock the same way a normal bill would');
    assert.equal(db.accounts.find(a => a.code === '2000').balance, 1000, 'AP must reflect the generated bill');
  });

  test('THE DOUBLE-CONVERSION BUG: converting an already-converted PO must be rejected, not create a second bill', async () => {
    const db = createDB();
    const product = setupCompany(db);
    const ctl = loadController('controllers/purchaseOrderController.js', db);

    const { req: r1, res: res1 } = mockReqRes({
      vendorId: 'v1', date: '2026-09-25',
      lines: [{ productId: product._id, quantity: 5, rate: 200, amount: 1000 }], total: 1000
    });
    await ctl.create(r1, res1);
    const poId = res1.body._id;

    await ctl.convertToBill(...Object.values(mockReqRes({ expenseAccount: '5200' }, { id: poId })));
    const { req: r2, res: res2 } = mockReqRes({ expenseAccount: '5200' }, { id: poId });
    await ctl.convertToBill(r2, res2);

    assert.equal(res2.statusCode, 400);
    assert.equal(db.bills.length, 1, 'must still be exactly one bill -- no duplicate created');
    assert.equal(product.stock, 15, 'stock must not be double-counted');
  });

  test('a converted PO cannot be deleted', async () => {
    const db = createDB();
    const product = setupCompany(db);
    const ctl = loadController('controllers/purchaseOrderController.js', db);

    const { req: r1, res: res1 } = mockReqRes({
      vendorId: 'v1', date: '2026-09-25',
      lines: [{ productId: product._id, quantity: 5, rate: 200, amount: 1000 }], total: 1000
    });
    await ctl.create(r1, res1);
    const poId = res1.body._id;
    await ctl.convertToBill(...Object.values(mockReqRes({ expenseAccount: '5200' }, { id: poId })));

    const { req, res } = mockReqRes({}, { id: poId });
    await ctl.delete(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(db.purchaseOrders.length, 1, 'PO must still exist');
  });

  test('cross-tenant access is rejected (IDOR)', async () => {
    const db = createDB();
    setupCompany(db);
    const ctl = loadController('controllers/purchaseOrderController.js', db);
    const { req: r1, res: res1 } = mockReqRes({
      vendorId: 'v1', date: '2026-09-25', lines: [{ description: 'x', quantity: 1, rate: 100, amount: 100 }], total: 100
    });
    await ctl.create(r1, res1);

    const { req, res } = mockReqRes({}, { id: res1.body._id }, { companyId: 'ATTACKER_CO', role: 'admin' });
    await ctl.getOne(req, res);

    assert.equal(res.statusCode, 404);
  });
});
