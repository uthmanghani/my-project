'use strict';
// Lightweight in-memory stand-ins for Mongoose models, shared across the
// test suite. This is NOT a MongoDB replacement -- it doesn't validate
// schemas or enforce indexes -- it exists so controller LOGIC (the part
// that has actually had real bugs: stock updates, balance math, IDOR
// scoping, idempotency) can be exercised in milliseconds with no database,
// on any machine, in CI, before every commit.
//
// Each test file calls createDB() for a fresh, isolated in-memory store,
// then loadController(path, db) to require a controller with its
// require('../models/X') calls transparently redirected to stubs backed by
// that store. The redirect is undone in a `finally` block, so it never
// leaks between tests even if a test throws.

const path = require('path');
const Module = require('module');

let idCounter = 0;
const nextId = () => 'id' + (++idCounter);

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const val = doc[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$in' in cond) return cond.$in.map(String).includes(String(val));
      if ('$ne' in cond) return String(val) !== String(cond.$ne);
      if ('$lte' in cond) return val <= cond.$lte;
      if ('$gte' in cond) return val >= cond.$gte;
      if ('$exists' in cond) return cond.$exists ? val !== undefined : val === undefined;
      return true;
    }
    return String(val) === String(cond);
  });
}

// A thenable, chainable stand-in for a Mongoose Query -- supports the
// handful of chain methods controllers in this app actually call
// (.session(), .populate(), .sort()) plus being awaited directly.
function queryOf(getResult) {
  const q = {
    session() { return q; },
    populate() { return q; },
    sort() { return q; },
    then(resolve, reject) {
      try { resolve(getResult()); } catch (e) { reject(e); }
    },
    catch(reject) { return Promise.resolve(this).catch(reject); }
  };
  return q;
}

// Builds one stub model class bound to `store` (a plain array acting as
// that model's in-memory collection).
function makeModel(store) {
  return class StubModel {
    constructor(data) {
      Object.assign(this, data);
      if (this._id === undefined) this._id = nextId();
    }
    async save() {
      if (!store.includes(this)) store.push(this);
      return this;
    }
    toObject() { return { ...this }; }

    static find(filter = {}) { return queryOf(() => store.filter(d => matches(d, filter))); }
    static findOne(filter = {}) { return queryOf(() => store.find(d => matches(d, filter)) || null); }
    static findById(id) { return queryOf(() => store.find(d => String(d._id) === String(id)) || null); }
    static countDocuments(filter = {}) { return queryOf(() => store.filter(d => matches(d, filter)).length); }
    static deleteOne(filter = {}) {
      return queryOf(() => {
        const before = store.length;
        const keep = store.filter(d => !matches(d, filter));
        store.length = 0;
        store.push(...keep);
        return { deletedCount: before - store.length };
      });
    }
    static findOneAndUpdate(filter, update, opts = {}) {
      return queryOf(() => {
        const doc = store.find(d => matches(d, filter));
        if (!doc) return null;
        Object.assign(doc, update);
        return doc;
      });
    }
    static findOneAndDelete(filter) {
      return queryOf(() => {
        const doc = store.find(d => matches(d, filter));
        if (!doc) return null;
        const keep = store.filter(d => d !== doc);
        store.length = 0;
        store.push(...keep);
        return doc;
      });
    }
  };
}

// One fresh, isolated in-memory database. Every model used anywhere in the
// backend gets a collection here (even ones a given test won't touch) so
// any controller can be loaded without missing-model errors.
function createDB() {
  const db = {
    accounts: [], products: [], bills: [], invoices: [], journalEntries: [],
    assets: [], purchaseOrders: [], recurringBillings: [], companies: [],
    payments: [], bankAccounts: [], bankTransactions: [], employees: [],
    auditLogs: [], customers: [], vendors: [],
  };
  db.models = {
    '../models/Account': makeModel(db.accounts),
    '../models/Product': makeModel(db.products),
    '../models/Bill': makeModel(db.bills),
    '../models/Invoice': makeModel(db.invoices),
    '../models/JournalEntry': makeModel(db.journalEntries),
    '../models/Asset': makeModel(db.assets),
    '../models/PurchaseOrder': makeModel(db.purchaseOrders),
    '../models/RecurringBilling': makeModel(db.recurringBillings),
    '../models/Payment': makeModel(db.payments),
    '../models/BankAccount': makeModel(db.bankAccounts),
    '../models/BankTransaction': makeModel(db.bankTransactions),
    '../models/Employee': makeModel(db.employees),
    '../models/AuditLog': makeModel(db.auditLogs),
    '../models/Customer': makeModel(db.customers),
    '../models/Vendor': makeModel(db.vendors),
    // Company is looked up a lot but never asserted on in these tests --
    // a fixed, reasonable default is enough.
    '../models/Company': {
      findById: () => queryOf(() => ({
        _id: 'company-1',
        taxStatus: {},
        approvalThreshold: 500000,
        settings: { nextInvoiceNumber: 1, invoicePrefix: 'INV-', defaultDueDays: 30 },
        save: async () => {}
      }))
    },
  };
  return db;
}

// Helper to seed an Account directly into a DB's store (bypasses the model
// class for brevity in test setup).
function seedAccount(db, { code, name, type, balance = 0, companyId = 'co1' }) {
  const acc = new db.models['../models/Account']({ companyId, code, name, type, balance });
  db.accounts.push(acc);
  return acc;
}

// Loads a controller (or any backend module) with its model requires
// transparently redirected to the given DB's stubs, plus a standard set of
// infrastructure stubs (mongoose transactions, audit logging, journal
// reversal) that every controller expects to exist but that no test here
// needs to assert on directly. Restores the real module loader afterward
// even if requiring the module throws.
function loadController(relativePath, db, extraStubs = {}) {
  const AppError = require(path.join(__dirname, '..', '..', 'utils', 'AppError.js'));
  const stubs = {
    mongoose: {
      Schema: function Schema() { this.index = () => {}; },
      model: () => class {},
      startSession: async () => ({
        startTransaction() {},
        commitTransaction: async () => {},
        abortTransaction: async () => {},
        endSession() {}
      }),
    },
    '../utils/AppError': AppError,
    '../utils/auditLog': { logAudit: async () => {} },
    '../utils/journalReversal': {},
    ...db.models,
    ...extraStubs,
  };

  const resolved = path.join(__dirname, '..', '..', relativePath);
  const backendRoot = path.join(__dirname, '..', '..');

  const install = () => { Module._load = patchedLoad; };
  const restore = () => { Module._load = original; };
  const original = Module._load;
  function patchedLoad(request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return original.call(this, request, ...rest);
  }

  let mod;
  install();
  try {
    // Bust the cache for every backend module under controllers/, models/,
    // and utils/ -- not just the one being loaded. Controllers frequently
    // require each other directly (purchaseOrderController requires
    // billController, recurringBillingController requires both invoice and
    // bill controllers), and a stale cached copy from an earlier test would
    // still be bound to THAT test's stub set, silently writing into the
    // wrong in-memory database.
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(backendRoot, 'controllers')) ||
          key.startsWith(path.join(backendRoot, 'models')) ||
          key.startsWith(path.join(backendRoot, 'utils'))) {
        delete require.cache[key];
      }
    }
    mod = require(resolved);
  } finally {
    restore();
  }

  // Several controllers (billController.create, for one) do a lazy
  // require('../models/X') INSIDE a function body rather than at the top
  // of the file, so it only runs when that function is actually called --
  // by which time the block above has already restored the real loader.
  // Wrapping every exported function to reinstall the override for the
  // duration of its own call (and only that call) covers those too,
  // without leaving the override installed globally between tests.
  const wrapped = {};
  for (const [key, val] of Object.entries(mod)) {
    if (typeof val === 'function') {
      wrapped[key] = function (...args) {
        install();
        try {
          const result = val.apply(mod, args);
          if (result && typeof result.finally === 'function') {
            return result.finally(restore);
          }
          restore();
          return result;
        } catch (e) {
          restore();
          throw e;
        }
      };
    } else {
      wrapped[key] = val;
    }
  }
  return wrapped;
}

// A minimal Express-like (req, res) pair. res.json()/res.status() behave
// like the real thing closely enough for every controller in this app,
// which never calls anything else on res.
function mockReqRes(body = {}, params = {}, user = { companyId: 'co1', role: 'admin' }) {
  const req = { body, params, user };
  const res = {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

module.exports = { createDB, seedAccount, loadController, mockReqRes, nextId };
