'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createDB, seedAccount, loadController, mockReqRes } = require('./helpers/mockModels');

function setupAsset(db, monthsAgo) {
  seedAccount(db, { code: '6400', name: 'Depreciation Expense', type: 'Expense' });
  seedAccount(db, { code: '1410', name: 'Accumulated Depreciation', type: 'Asset' });
  const purchaseDate = new Date();
  purchaseDate.setMonth(purchaseDate.getMonth() - monthsAgo);
  const Asset = db.models['../models/Asset'];
  const asset = new Asset({
    companyId: 'co1', name: 'Generator', purchaseDate,
    purchaseCost: 1200000, usefulLifeYears: 5, residualValue: 0,
    lastDepreciationDate: null, accumulatedDepreciation: 0
  });
  db.assets.push(asset);
  return asset;
}

describe('assetController.postDepreciation', () => {
  test('first run charges depreciation for every month since purchase', async () => {
    const db = createDB();
    const asset = setupAsset(db, 25); // 1,200,000 / 5yr / 12 = 20,000/mo; 25mo = 500,000
    const ctl = loadController('controllers/assetController.js', db);

    const { req, res } = mockReqRes({}, { id: asset._id });
    await ctl.postDepreciation(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.amount, 500000);
    assert.equal(res.body.monthsPosted, 25);
    assert.equal(asset.accumulatedDepreciation, 500000);
    assert.ok(asset.lastDepreciationDate, 'lastDepreciationDate must be set after posting');
  });

  test('THE DOUBLE-POST BUG: running it again the same month must be rejected, not re-charged', async () => {
    const db = createDB();
    const asset = setupAsset(db, 25);
    const ctl = loadController('controllers/assetController.js', db);

    await ctl.postDepreciation(...Object.values(mockReqRes({}, { id: asset._id })));
    const { req, res } = mockReqRes({}, { id: asset._id });
    await ctl.postDepreciation(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /already been posted/);
    assert.equal(asset.accumulatedDepreciation, 500000, 'accumulated total must not double');
  });

  test('a later run only charges the months not yet posted', async () => {
    const db = createDB();
    const asset = setupAsset(db, 25);
    const ctl = loadController('controllers/assetController.js', db);
    await ctl.postDepreciation(...Object.values(mockReqRes({}, { id: asset._id })));

    // Simulate 3 more months passing since the last post.
    asset.lastDepreciationDate = new Date(new Date().setMonth(new Date().getMonth() - 3));
    const { req, res } = mockReqRes({}, { id: asset._id });
    await ctl.postDepreciation(req, res);

    assert.equal(res.body.amount, 60000, '3 months at 20,000/mo');
    assert.equal(asset.accumulatedDepreciation, 560000);
  });

  test('accumulated depreciation is capped at the depreciable amount, even after a long gap', async () => {
    const db = createDB();
    const asset = setupAsset(db, 200); // wildly more months than the 5-year useful life
    const ctl = loadController('controllers/assetController.js', db);

    const { req, res } = mockReqRes({}, { id: asset._id });
    await ctl.postDepreciation(req, res);

    assert.equal(asset.accumulatedDepreciation, 1200000, 'must never exceed purchaseCost - residualValue');
  });

  test('cross-tenant access is rejected (IDOR)', async () => {
    const db = createDB();
    const asset = setupAsset(db, 25);
    const ctl = loadController('controllers/assetController.js', db);

    const { req, res } = mockReqRes({}, { id: asset._id }, { companyId: 'ATTACKER_CO', role: 'admin' });
    await ctl.postDepreciation(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(asset.accumulatedDepreciation, 0, 'attacker must not be able to post against another company\'s asset');
  });
});
