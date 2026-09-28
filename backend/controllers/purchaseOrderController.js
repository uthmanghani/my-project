const PurchaseOrder = require('../models/PurchaseOrder');
const AppError = require('../utils/AppError');
const billController = require('./billController');

exports.getAll = async (req, res) => {
  try {
    const pos = await PurchaseOrder.find({ companyId: req.user.companyId })
      .populate('vendorId', 'name email phone')
      .sort({ date: -1 });
    res.json(pos);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.getOne = async (req, res) => {
  try {
    const po = await PurchaseOrder.findOne({ companyId: req.user.companyId, _id: req.params.id })
      .populate('vendorId', 'name email phone');
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    res.json(po);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.create = async (req, res) => {
  try {
    const { vendorId, date, expectedDate, lines, total, notes } = req.body;

    // Same verify-actually-free numbering pattern as bills/invoices, rather
    // than a bare count+1 that drifts and collides under concurrent use.
    const yearPrefix = 'PO-' + new Date().getFullYear() + '-';
    let candidateNum = (await PurchaseOrder.countDocuments({ companyId: req.user.companyId })) + 1;
    let number = yearPrefix + String(candidateNum).padStart(4, '0');
    while (await PurchaseOrder.findOne({ companyId: req.user.companyId, number })) {
      candidateNum += 1;
      number = yearPrefix + String(candidateNum).padStart(4, '0');
    }

    // Maker-checker: reuses the same company.approvalThreshold as bills,
    // rather than a second, separately-configured number — a PO is a
    // spend commitment just like a bill, and a business that wants sign-off
    // on one above a given size will want it on the other at the same size.
    const Company = require('../models/Company');
    const company = await Company.findById(req.user.companyId);
    const approvalThreshold = (company && company.approvalThreshold) || 500000;
    const needsApproval = req.user.role !== 'admin' && total > approvalThreshold;

    const po = new PurchaseOrder({
      companyId: req.user.companyId,
      number,
      vendorId,
      date,
      expectedDate,
      lines,
      total,
      notes,
      status: 'open',
      approvalStatus: needsApproval ? 'pending_approval' : 'approved'
    });
    await po.save();
    res.status(201).json(po);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Approve a pending purchase order — clears it to be converted to a bill
// or sent to the vendor.
exports.approve = async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can approve purchase orders' });
  }
  try {
    const po = await PurchaseOrder.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.approvalStatus !== 'pending_approval') {
      return res.status(400).json({ error: 'Purchase order is not pending approval' });
    }
    po.approvalStatus = 'approved';
    await po.save();
    res.json(po);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Reject a pending purchase order. A PO never posts a journal entry or
// touches stock on its own (only convertToBill does, which is itself
// blocked below while pending), so — same as a rejected bill — there is
// nothing to reverse; this is a plain state change.
exports.reject = async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can reject purchase orders' });
  }
  try {
    const po = await PurchaseOrder.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.approvalStatus !== 'pending_approval') {
      return res.status(400).json({ error: 'Purchase order is not pending approval' });
    }
    po.approvalStatus = 'rejected';
    po.status = 'cancelled';
    await po.save();
    res.json(po);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await PurchaseOrder.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
    if (existing.status !== 'open') {
      throw new AppError('This purchase order has already been converted or cancelled and can no longer be edited', 400);
    }
    const { vendorId, date, expectedDate, lines, total, notes } = req.body;
    Object.assign(existing, { vendorId, date, expectedDate, lines, total, notes });
    // Re-run the same threshold check as create(): otherwise a non-admin
    // could enter a PO just under the threshold to get it auto-approved,
    // then raise the total afterward and slip the increase past sign-off
    // entirely. Only escalates (approved -> pending) for non-admins; never
    // silently clears an existing pending/rejected state.
    if (req.user.role !== 'admin' && existing.approvalStatus === 'approved') {
      const Company = require('../models/Company');
      const company = await Company.findById(req.user.companyId);
      const approvalThreshold = (company && company.approvalThreshold) || 500000;
      if (total > approvalThreshold) existing.approvalStatus = 'pending_approval';
    }
    await existing.save();
    res.json(existing);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.delete = async (req, res) => {
  try {
    const po = await PurchaseOrder.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.status === 'converted') {
      throw new AppError('This purchase order has already been converted to a bill and cannot be deleted', 400);
    }
    await PurchaseOrder.deleteOne({ _id: po._id, companyId: req.user.companyId });
    res.json({ message: 'Purchase order deleted' });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Converts an open PO into a real Bill by calling billController.create
// internally (same function the "New Bill" form hits), so this gets every
// fix already made to bill posting -- product-line-driven stock updates,
// WHT handling, maker-checker approval -- for free, and stays that way if
// billController changes again later, rather than re-implementing (and
// re-risking) that logic here.
exports.convertToBill = async (req, res) => {
  try {
    const po = await PurchaseOrder.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!po) throw new AppError('Purchase order not found', 404);
    if (po.status !== 'open') {
      throw new AppError('This purchase order has already been converted or cancelled', 400);
    }
    if (po.approvalStatus === 'pending_approval') {
      throw new AppError('This purchase order is awaiting approval and cannot be converted to a bill yet.', 400);
    }
    const { expenseAccount, whtRate, dueDate } = req.body;
    if (!expenseAccount) throw new AppError('expenseAccount is required to convert a purchase order to a bill', 400);

    const innerReq = {
      user: req.user,
      body: {
        vendorId: po.vendorId,
        date: new Date(),
        dueDate: dueDate || null,
        lines: po.lines,
        total: po.total,
        whtRate: whtRate || 0,
        expenseAccount
      }
    };
    let created = null, errorBody = null, statusCode = 200;
    const innerRes = {
      status(c) { statusCode = c; return this; },
      json(body) {
        if (statusCode >= 200 && statusCode < 300) created = body;
        else errorBody = body;
        return this;
      }
    };
    await billController.create(innerReq, innerRes);
    if (!created) {
      return res.status(statusCode || 500).json(errorBody || { error: 'Failed to create a bill from this purchase order' });
    }

    po.status = 'converted';
    po.convertedBillId = created._id;
    po.convertedAt = new Date();
    await po.save();

    res.json({ message: 'Purchase order converted to bill', bill: created, purchaseOrder: po });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
