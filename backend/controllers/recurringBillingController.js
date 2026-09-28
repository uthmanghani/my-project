const RecurringBilling = require('../models/RecurringBilling');
const AppError = require('../utils/AppError');
const invoiceController = require('./invoiceController');
const billController = require('./billController');

exports.getAll = async (req, res) => {
  try {
    const list = await RecurringBilling.find({ companyId: req.user.companyId }).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, type, entityId, amount, description, frequency, nextDate, endDate, expenseAccount } = req.body;
    const rb = new RecurringBilling({
      companyId: req.user.companyId,
      name, type, entityId, amount, description, frequency, nextDate, endDate,
      expenseAccount: expenseAccount || '6000',
      active: true
    });
    await rb.save();
    res.status(201).json(rb);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Used for both editing a schedule's details and toggling active/paused —
// the frontend's pause/resume button just sends { active: !current }.
exports.update = async (req, res) => {
  try {
    const rb = await RecurringBilling.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!rb) return res.status(404).json({ error: 'Recurring schedule not found' });
    res.json(rb);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.delete = async (req, res) => {
  try {
    const rb = await RecurringBilling.findOneAndDelete({ companyId: req.user.companyId, _id: req.params.id });
    if (!rb) return res.status(404).json({ error: 'Recurring schedule not found' });
    res.json({ message: 'Recurring schedule deleted. Already-generated invoices/bills are not affected.' });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Generates one invoice or bill from a schedule, by calling the SAME
// invoiceController.create / billController.create used by the real "New
// Invoice"/"New Bill" forms — so a recurring-generated record gets full,
// correct accounting treatment (AR/Revenue/VAT, or AP/expense/WHT) rather
// than a hand-rolled duplicate of that logic here. Does not throw; returns
// { created } or { error } so the daily cron can keep going after one
// schedule's failure instead of aborting the whole run.
async function runOne(rb) {
  const innerReq = { user: { companyId: rb.companyId, role: 'admin' }, body: null };
  let created = null, errorBody = null, statusCode = 200;
  const innerRes = {
    status(c) { statusCode = c; return this; },
    json(body) {
      if (statusCode >= 200 && statusCode < 300) created = body;
      else errorBody = body;
      return this;
    }
  };

  const today = new Date();
  const dueDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days, matching this app's default elsewhere

  if (rb.type === 'invoice') {
    innerReq.body = {
      customerId: rb.entityId,
      date: today,
      dueDate,
      lines: [{ description: rb.description || rb.name, quantity: 1, rate: rb.amount, amount: rb.amount, vatApplicable: false }],
      subtotal: rb.amount,
      vat: 0,
      total: rb.amount
    };
    await invoiceController.create(innerReq, innerRes);
  } else {
    innerReq.body = {
      vendorId: rb.entityId,
      date: today,
      dueDate,
      lines: [{ description: rb.description || rb.name, quantity: 1, rate: rb.amount, amount: rb.amount }],
      total: rb.amount,
      whtRate: 0,
      expenseAccount: rb.expenseAccount || '6000'
    };
    await billController.create(innerReq, innerRes);
  }

  if (!created) return { error: (errorBody && errorBody.error) || 'Failed to generate from this schedule' };
  return { created };
}

function advance(date, frequency) {
  const next = new Date(date);
  if (frequency === 'weekly') next.setDate(next.getDate() + 7);
  else if (frequency === 'monthly') next.setMonth(next.getMonth() + 1);
  else if (frequency === 'quarterly') next.setMonth(next.getMonth() + 3);
  else next.setFullYear(next.getFullYear() + 1); // yearly, and any unrecognized value
  return next;
}

// Manual "Run Now" from the Recurring Billing page.
exports.run = async (req, res) => {
  try {
    const rb = await RecurringBilling.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!rb) throw new AppError('Recurring schedule not found', 404);
    if (!rb.active) throw new AppError('This schedule is paused. Resume it before running it.', 400);

    const { created, error } = await runOne(rb);
    if (error) throw new AppError(error, 400);

    rb.nextDate = advance(rb.nextDate, rb.frequency);
    rb.lastRunAt = new Date();
    await rb.save();

    res.json({
      message: `${rb.type === 'invoice' ? 'Invoice' : 'Bill'} generated from schedule: ${rb.name}`,
      record: created,
      schedule: rb
    });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Exported so utils/recurringBillingJob.js (the daily cron) can reuse the
// exact same generation + advancement logic as the manual "Run Now" button.
exports._internal = { runOne, advance };
