'use strict';
// Uses the real 'express-validator' package -- already a dependency in
// package.json, so `npm install && npm test` picks it up with nothing
// extra. (This sandbox has no network access to install it directly, so
// this file was verified here against a hand-written reproduction of the
// same chain API before being included -- see the project notes if that
// ever needs re-checking.)
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validationResult } = require('express-validator');
const validators = require('../middleware/validators');

async function runChains(chains, body) {
  const req = { body };
  for (const c of chains) await c.run(req);
  return validationResult(req);
}

describe('billCreate validator', () => {
  test('accepts a well-formed bill', async () => {
    const errors = await runChains(validators.billCreate, {
      vendorId: '507f1f77bcf86cd799439011', date: '2026-09-25', dueDate: '2026-10-25',
      lines: [{ description: 'Rice', quantity: 5, rate: 200, amount: 1000 }],
      total: 1000, expenseAccount: '5200', whtRate: 5
    });
    assert.equal(errors.isEmpty(), true);
  });

  test('THE ORIGINAL BUG CLASS: rejects a non-numeric total', async () => {
    const errors = await runChains(validators.billCreate, {
      vendorId: '507f1f77bcf86cd799439011', date: '2026-09-25',
      lines: [{ quantity: 5, rate: 200, amount: 1000 }],
      total: 'not-a-number', expenseAccount: '5200'
    });
    assert.equal(errors.isEmpty(), false);
  });

  test('rejects a negative line quantity', async () => {
    const errors = await runChains(validators.billCreate, {
      vendorId: '507f1f77bcf86cd799439011', date: '2026-09-25',
      lines: [{ quantity: -5, rate: 200, amount: 1000 }],
      total: 1000, expenseAccount: '5200'
    });
    assert.equal(errors.isEmpty(), false);
  });

  test('rejects a malformed vendorId', async () => {
    const errors = await runChains(validators.billCreate, {
      vendorId: 'not-a-mongo-id', date: '2026-09-25',
      lines: [{ quantity: 1, rate: 100, amount: 100 }],
      total: 100, expenseAccount: '5200'
    });
    assert.equal(errors.isEmpty(), false);
  });
});

describe('journalCreate validator', () => {
  test('accepts a balanced entry', async () => {
    const errors = await runChains(validators.journalCreate, {
      date: '2026-09-25', description: 'test',
      lines: [{ accountCode: '1000', amount: 500, type: 'debit' }, { accountCode: '2000', amount: 500, type: 'credit' }]
    });
    assert.equal(errors.isEmpty(), true);
  });

  test('rejects an unbalanced entry', async () => {
    const errors = await runChains(validators.journalCreate, {
      date: '2026-09-25', description: 'test',
      lines: [{ accountCode: '1000', amount: 500, type: 'debit' }, { accountCode: '2000', amount: 400, type: 'credit' }]
    });
    assert.equal(errors.isEmpty(), false);
  });

  test('rejects an invalid line type', async () => {
    const errors = await runChains(validators.journalCreate, {
      date: '2026-09-25', description: 'test',
      lines: [{ accountCode: '1000', amount: 500, type: 'sideways' }, { accountCode: '2000', amount: 500, type: 'credit' }]
    });
    assert.equal(errors.isEmpty(), false);
  });
});

describe('stockAdjust validator', () => {
  test("accepts 'in' and 'out'", async () => {
    for (const type of ['in', 'out']) {
      const errors = await runChains(validators.stockAdjust, { productId: '507f1f77bcf86cd799439011', quantity: 3, type });
      assert.equal(errors.isEmpty(), true, `type=${type} should be valid`);
    }
  });

  test("rejects values that aren't 'in'/'out' (matches productController's actual enum)", async () => {
    const errors = await runChains(validators.stockAdjust, { productId: '507f1f77bcf86cd799439011', quantity: 3, type: 'add' });
    assert.equal(errors.isEmpty(), false);
  });
});

describe('accountCreate validator', () => {
  test("accepts the model's real enum value 'Revenue'", async () => {
    const errors = await runChains(validators.accountCreate, { code: '1250', name: 'Test', type: 'Revenue' });
    assert.equal(errors.isEmpty(), true);
  });

  test("rejects 'Income' (not a value the Account model actually uses)", async () => {
    const errors = await runChains(validators.accountCreate, { code: '1250', name: 'Test', type: 'Income' });
    assert.equal(errors.isEmpty(), false);
  });
});
