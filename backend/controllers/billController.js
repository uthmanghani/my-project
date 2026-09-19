const Bill = require('../models/Bill');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');
const Product = require('../models/Product');
const Payment = require('../models/Payment');
// Version fingerprint — checked by GET /health.
exports.__VERSION__ = 'bill-controller-2026-09-19-stock-from-product-lines';
const BankAccount = require('../models/BankAccount');
const BankTransaction = require('../models/BankTransaction');
const mongoose = require('mongoose');
const { reverseAllEntriesFor } = require('../utils/journalReversal');
const { logAudit } = require('../utils/auditLog');

// Get all bills for the company
exports.getAll = async (req, res) => {
  try {
    const bills = await Bill.find({ companyId: req.user.companyId })
      .populate('vendorId', 'name email phone')
      .sort({ date: -1 });
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get a single bill by ID
exports.getOne = async (req, res) => {
  try {
    const bill = await Bill.findOne({
      companyId: req.user.companyId,
      _id: req.params.id
    }).populate('vendorId', 'name email phone');
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    res.json(bill);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------------
// Inventory + posting helpers (shared by create and approve)
// ---------------------------------------------------------------------------
const INVENTORY_ACCOUNT_RE = /inventory|stock|raw material|work[- ]?in[- ]?progress|finished goods/i;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function isInventoryAccount(acct) {
  return !!(acct && acct.type === 'Asset' && INVENTORY_ACCOUNT_RE.test(acct.name || ''));
}

// Decides, server-side, which bill lines receive stock.
//
// ROOT CAUSE of "ledger updates but Products doesn't": stock used to move
// ONLY when the account picked on the bill was an Asset account whose NAME
// matched an inventory pattern. Pick any other account (e.g. an expense
// account like "Purchases", or an inventory account with an unusual name)
// and the journal + account balances still posted, but the product loop was
// skipped entirely. A line that carries a product IS a stock receipt, so
// stock now follows the product lines themselves, not the account name.
async function planBillPosting(bill, companyId, session) {
  const expenseAccountDoc = await Account.findOne({ companyId, code: bill.expenseAccount }).session(session);

  const ids = [...new Set((bill.lines || []).filter(l => l.productId).map(l => String(l.productId)))];
  const products = ids.length
    ? await Product.find({ _id: { $in: ids }, companyId }).session(session)
    : [];
  const byId = new Map(products.map(p => [String(p._id), p]));

  const stockLines = [];
  for (const line of bill.lines || []) {
    const product = line.productId ? byId.get(String(line.productId)) : null;
    const qty = Number(line.quantity);
    if (!product || !(qty > 0)) continue;
    const rate = Number(line.rate) || 0;
    const amount = Number(line.amount) > 0 ? Number(line.amount) : qty * rate;
    stockLines.push({ product, qty, rate, amount });
  }

  return {
    expenseAccountDoc,
    stockLines,
    isInventoryPurchase: stockLines.length > 0 || isInventoryAccount(expenseAccountDoc)
  };
}

// Posts a bill: receives stock (weighted-average cost), writes the journal
// entry and updates account balances. Runs inside the caller's transaction.
async function postBill(bill, plan, companyId, session, description) {
  const { expenseAccountDoc, stockLines } = plan;
  const apAccount = await Account.findOne({ companyId, code: '2000' }).session(session);
  if (!apAccount || !expenseAccountDoc) throw new Error('Required accounts not found');

  // One document instance per account code, so several balance changes to
  // the same account can never overwrite each other.
  const accounts = new Map([[expenseAccountDoc.code, expenseAccountDoc], [apAccount.code, apAccount]]);
  const changed = new Set();
  const getAccount = async (code) => {
    if (accounts.has(code)) return accounts.get(code);
    const acct = await Account.findOne({ companyId, code }).session(session);
    if (acct) accounts.set(code, acct);
    return acct;
  };

  // ---- 1. Stock + weighted-average cost ----
  const summary = new Map();
  for (const sl of stockLines) {
    const p = sl.product;
    const oldStock = p.stock || 0;
    const oldCost = p.cost || 0;
    if (sl.rate > 0 && oldStock + sl.qty > 0) {
      p.cost = (oldStock * oldCost + sl.qty * sl.rate) / (oldStock + sl.qty);
    }
    p.stock = oldStock + sl.qty;
    const key = String(p._id);
    const entry = summary.get(key) || { productId: key, name: p.name, added: 0, product: p };
    entry.added += sl.qty;
    summary.set(key, entry);
  }
  for (const entry of summary.values()) await entry.product.save({ session });
  const stockUpdates = [...summary.values()].map(e => ({
    productId: e.productId, name: e.name, added: e.added, newStock: e.product.stock
  }));

  // ---- 2. Debit side ----
  // If the account chosen on the bill is itself an inventory account, keep
  // the user's choice for everything. Otherwise product lines are debited to
  // the product's own inventory account, so the ledger and the Products
  // module agree; any non-product remainder stays on the chosen account.
  const debits = new Map();
  const addDebit = (code, amt) => debits.set(code, round2((debits.get(code) || 0) + amt));
  const routed = [];
  if (!isInventoryAccount(expenseAccountDoc)) {
    for (const sl of stockLines) {
      const invAcct = await getAccount(sl.product.inventoryAccountCode || '1200');
      if (invAcct) routed.push({ code: invAcct.code, amount: round2(sl.amount) });
    }
  }
  const routedTotal = round2(routed.reduce((s, r) => s + r.amount, 0));
  if (routed.length && routedTotal <= round2(bill.total) + 0.005) {
    routed.forEach(r => addDebit(r.code, r.amount));
    const rest = round2(bill.total - routedTotal);
    if (rest > 0.005) addDebit(expenseAccountDoc.code, rest);
    else addDebit(routed[routed.length - 1].code, rest); // absorb rounding
  } else {
    addDebit(expenseAccountDoc.code, bill.total);
  }

  const journalLines = [...debits.entries()].map(([accountCode, amount]) => ({ accountCode, amount, type: 'debit' }));

  // ---- 3. Credit side (AP, plus WHT payable when applicable) ----
  let whtAccount = null;
  if (bill.whtAmount > 0) {
    whtAccount = await getAccount('2250');
    if (!whtAccount) {
      whtAccount = new Account({
        companyId,
        code: '2250',
        name: 'WHT Payable (NRS)',
        type: 'Liability',
        balance: 0
      });
      accounts.set('2250', whtAccount);
    }
    journalLines.push({ accountCode: '2250', amount: bill.whtAmount, type: 'credit' });
    journalLines.push({ accountCode: apAccount.code, amount: bill.netPayable, type: 'credit' });
  } else {
    journalLines.push({ accountCode: apAccount.code, amount: bill.total, type: 'credit' });
  }

  const journal = new JournalEntry({
    companyId,
    date: bill.date,
    description,
    type: 'bill',
    referenceType: 'bill',
    referenceId: bill._id,
    lines: journalLines
  });
  await journal.save({ session });

  // ---- 4. Account balances ----
  for (const [code, amt] of debits) {
    accounts.get(code).balance += amt;
    changed.add(code);
  }
  apAccount.balance += (bill.whtAmount > 0 ? bill.netPayable : bill.total);
  changed.add(apAccount.code);
  if (whtAccount) {
    whtAccount.balance += bill.whtAmount;
    changed.add('2250');
  }
  for (const code of changed) await accounts.get(code).save({ session });

  return { journal, stockUpdates };
}

// Create a new bill
exports.create = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      vendorId, date, dueDate, lines, total,
      whtRate, expenseAccount
    } = req.body;

    // Generate bill number
    const Company = require('../models/Company');
    const company = await Company.findById(req.user.companyId).session(session);
    // A count-based number ('count + 1') drifts out of sync with what's
    // actually saved whenever data is cleared, imported, or created under
    // concurrent load — and Bill.number has a unique index, so a collision
    // throws exactly like the invoice numbering bug did. Verify each
    // candidate is actually free rather than trusting the count blindly.
    const yearPrefix = 'BILL-' + new Date().getFullYear() + '-';
    let candidateNum = (await Bill.countDocuments({ companyId: req.user.companyId })) + 1;
    let billNumber = yearPrefix + String(candidateNum).padStart(4, '0');
    let existingBill = await Bill.findOne({ companyId: req.user.companyId, number: billNumber }).session(session);
    while (existingBill) {
      candidateNum += 1;
      billNumber = yearPrefix + String(candidateNum).padStart(4, '0');
      existingBill = await Bill.findOne({ companyId: req.user.companyId, number: billNumber }).session(session);
    }

    // NTA 2025: the ₦2,000,000 WHT de minimis exemption applies specifically
    // to SMALL COMPANIES (not every company regardless of size), and is
    // enforced here rather than trusting a client-sent whtRate.
    const taxStatus = company?.taxStatus || {};
    const qualifiesAsSmallCompany = taxStatus.isSmallCompany && !taxStatus.isProfessionalServices;
    const whtDeMinimis = taxStatus.whtDeMinimisThreshold ?? 2000000;
    const effectiveWhtRate = (qualifiesAsSmallCompany && total < whtDeMinimis) ? 0 : whtRate;
    const whtAmount = effectiveWhtRate ? parseFloat((total * (effectiveWhtRate / 100)).toFixed(2)) : 0;
    const netPayable = parseFloat((total - whtAmount).toFixed(2));

    // Maker-checker: non-admins creating a bill above the threshold get
    // routed to pending approval — no ledger or stock impact until approved.
    const approvalThreshold = (company && company.approvalThreshold) || 500000;
    const needsApproval = req.user.role !== 'admin' && total > approvalThreshold;

    const bill = new Bill({
      companyId: req.user.companyId,
      number: billNumber,
      vendorId,
      date,
      dueDate,
      lines,
      total,
      whtRate: effectiveWhtRate || 0,
      whtAmount,
      netPayable,
      status: 'unpaid',
      payments: [],
      amountPaid: 0,
      balance: netPayable,
      expenseAccount,
      isInventoryPurchase: false,
      approvalStatus: needsApproval ? 'pending_approval' : 'approved'
    });

    // Never trust a client-sent isInventoryPurchase flag — work it out here
    // from the product lines (and the selected account) on the saved bill.
    const plan = await planBillPosting(bill, req.user.companyId, session);
    bill.isInventoryPurchase = plan.isInventoryPurchase;
    await bill.save({ session });

    if (needsApproval) {
      // Stop here — no stock, no journal entry, no account balances until
      // an admin calls PUT /:id/approve for this bill.
      await session.commitTransaction();
      return res.status(201).json(bill);
    }

    const withProduct = (bill.lines || []).filter(l => l.productId).length;
    if (withProduct && !plan.stockLines.length) {
      console.warn(`[bill ${billNumber}] ${withProduct} line(s) carry a productId but none matched a product in this company (or quantity <= 0) — stock NOT updated`);
    } else if (!withProduct && plan.isInventoryPurchase) {
      console.warn(`[bill ${billNumber}] inventory account selected but no line carries a productId — stock NOT updated. Check what the frontend sends in lines[].productId`);
    }

    const { stockUpdates } = await postBill(
      bill, plan, req.user.companyId, session,
      `Bill ${billNumber} - ${plan.isInventoryPurchase ? 'Inventory Purchase' : 'Expense'}`
    );

    await session.commitTransaction();
    res.status(201).json({ ...bill.toObject(), stockUpdates });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

// Approve a pending bill — posts the stock update and journal entry that
// were withheld when the bill was created above the approval threshold.
exports.approve = async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can approve bills' });
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const bill = await Bill.findOne({ companyId: req.user.companyId, _id: req.params.id }).session(session);
    if (!bill) throw new Error('Bill not found');
    if (bill.approvalStatus !== 'pending_approval') {
      throw new Error('Bill is not pending approval');
    }

    const plan = await planBillPosting(bill, req.user.companyId, session);
    bill.isInventoryPurchase = plan.isInventoryPurchase;

    const { stockUpdates } = await postBill(
      bill, plan, req.user.companyId, session,
      `Bill ${bill.number} - Approved (${plan.isInventoryPurchase ? 'Inventory Purchase' : 'Expense'})`
    );

    bill.approvalStatus = 'approved';
    await bill.save({ session });

    await session.commitTransaction();
    res.json({ ...bill.toObject(), stockUpdates });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

// Update a bill
exports.update = async (req, res) => {
  try {
    const bill = await Bill.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    res.json(bill);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Record payment for a bill
exports.recordPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { amount, date, bankCode } = req.body;
    const bill = await Bill.findById(req.params.id).session(session);
    if (!bill) throw new Error('Bill not found');
    if (bill.status === 'paid') throw new Error('Bill already fully paid');

    const remaining = bill.netPayable - bill.amountPaid;
    const paidAmount = Math.min(amount, remaining);
    
    bill.payments.push({ date, amount: paidAmount });
    bill.amountPaid += paidAmount;
    bill.balance = bill.netPayable - bill.amountPaid;
    if (bill.balance <= 0.005) bill.status = 'paid';
    else if (bill.amountPaid > 0.005) bill.status = 'partial';
    await bill.save({ session });

    // Journal entry: Dr AP, Cr Cash
    const apAccount = await Account.findOne({ companyId: req.user.companyId, code: '2000' }).session(session);
    const cashAccount = await Account.findOne({ companyId: req.user.companyId, code: bankCode || '1000' }).session(session);
    
    if (!apAccount || !cashAccount) throw new Error('Required accounts not found');

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date,
      description: `Payment for Bill ${bill.number}`,
      type: 'payment',
      referenceType: 'bill',
      referenceId: bill._id,
      lines: [
        { accountCode: apAccount.code, amount: paidAmount, type: 'debit' },
        { accountCode: cashAccount.code, amount: paidAmount, type: 'credit' }
      ]
    });
    await journal.save({ session });

    // Update account balances
    apAccount.balance -= paidAmount;
    cashAccount.balance -= paidAmount;
    await apAccount.save({ session });
    await cashAccount.save({ session });

    // Save payment record
    const paymentRecord = new Payment({
      companyId: req.user.companyId,
      type: 'vendor',
      entityId: bill.vendorId,
      billId: bill._id,
      amount: paidAmount,
      date,
      bankAccountCode: bankCode || '1000'
    });
    await paymentRecord.save({ session });

    // Create the actual BankTransaction record — without this, money moves
    // correctly in the ledger Account balance, but the Banking module (which
    // reads from this separate collection, matched by bankId) never shows
    // this payment at all, and it can't be reconciled.
    const bankAccountDoc = await BankAccount.findOne({ companyId: req.user.companyId, code: bankCode || '1000' }).session(session);
    if (bankAccountDoc) {
      const bankTx = new BankTransaction({
        companyId: req.user.companyId,
        bankId: bankAccountDoc._id,
        bankAccountCode: bankCode || '1000',
        date,
        type: 'debit', // money leaving the bank to pay a vendor
        amount: paidAmount,
        description: `Payment to vendor - Bill ${bill.number}`,
        reference: bill.number,
        reconciled: false
      });
      await bankTx.save({ session });
    }

    await session.commitTransaction();
    res.json(bill);
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

// Delete a bill
exports.delete = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const bill = await Bill.findOne({
      companyId: req.user.companyId,
      _id: req.params.id
    }).session(session);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.voided) return res.status(400).json({ error: 'This bill has already been voided' });
    if (bill.amountPaid > 0.005) {
      return res.status(400).json({
        error: 'This bill has payments applied. Reverse or delete those payments before voiding the bill.'
      });
    }

    // Reverse every journal entry this bill posted (main entry + any COGS
    // entry) — this correctly restores account balances too, unlike the
    // previous behavior which deleted the journal entries but left the
    // account balances they'd changed permanently wrong.
    await reverseAllEntriesFor({
      referenceType: 'bill',
      referenceId: bill._id,
      companyId: req.user.companyId,
      userId: req.user.userId,
      reason: req.body.reason,
      session
    });

    // Reverse the stock quantity impact for inventory purchases. Note:
    // this restores the quantity exactly, but does not attempt to
    // perfectly reconstruct the pre-purchase weighted-average cost —
    // doing that correctly requires full cost-lot history, which this
    // system doesn't track. The cost basis may need manual review after
    // voiding an inventory bill with a non-trivial purchase history.
    if (bill.isInventoryPurchase) {
      for (const line of bill.lines) {
        if (line.productId) {
          const product = await Product.findById(line.productId).session(session);
          if (product) {
            product.stock = Math.max(0, (product.stock || 0) - line.quantity);
            await product.save({ session });
          }
        }
      }
    }

    bill.voided = true;
    bill.voidedAt = new Date();
    bill.voidedBy = req.user.userId;
    bill.voidReason = req.body.reason || null;
    await bill.save({ session });

    await logAudit(req, 'BILL_VOIDED', `Voided Bill ${bill.number}${req.body.reason ? ' — ' + req.body.reason : ''}`, session);

    await session.commitTransaction();
    res.json({ message: 'Bill voided. Journal entries reversed and stock impact reverted.' });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};