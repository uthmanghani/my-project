const Bill = require('../models/Bill');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');
const Product = require('../models/Product');
const Payment = require('../models/Payment');
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

// Create a new bill
exports.create = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      vendorId, date, dueDate, lines, total,
      whtRate, expenseAccount, isInventoryPurchase
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

    // NTA 2025: payments below the de minimis threshold are exempt from
    // WHT entirely, regardless of what rate was requested — enforced
    // here, not just as a frontend default, since a client could still
    // send a non-zero whtRate.
    const whtDeMinimis = (company?.taxStatus?.whtDeMinimisThreshold) ?? 2000000;
    const effectiveWhtRate = total < whtDeMinimis ? 0 : whtRate;
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
      balance: total,
      expenseAccount,
      isInventoryPurchase: isInventoryPurchase || false,
      approvalStatus: needsApproval ? 'pending_approval' : 'approved'
    });
    await bill.save({ session });

    if (needsApproval) {
      // Stop here — no stock, no journal entry, no account balances until
      // an admin calls PUT /:id/approve for this bill.
      await session.commitTransaction();
      return res.status(201).json(bill);
    }

    // Handle inventory purchase - update stock AND cost (weighted average).
    // This is the ONLY place stock/cost update for a bill — the frontend no
    // longer makes a separate /products/adjust call for bill-driven receipts,
    // which previously caused stock to be double-counted.
    if (isInventoryPurchase) {
      for (const line of lines) {
        if (line.productId) {
          const product = await Product.findById(line.productId).session(session);
          if (product && line.quantity > 0) {
            const oldStock = product.stock || 0;
            const oldCost = product.cost || 0;
            const unitCost = line.rate || 0;
            if (unitCost > 0) {
              const oldValue = oldStock * oldCost;
              const newValue = line.quantity * unitCost;
              product.cost = (oldValue + newValue) / (oldStock + line.quantity);
            }
            product.stock = oldStock + line.quantity;
            await product.save({ session });
          }
        }
      }
    }

    // Post journal entry
    const apAccount = await Account.findOne({ companyId: req.user.companyId, code: '2000' }).session(session);
    const expenseAccountDoc = await Account.findOne({ companyId: req.user.companyId, code: expenseAccount }).session(session);
    
    if (!apAccount || !expenseAccountDoc) {
      throw new Error('Required accounts not found');
    }

    const journalLines = [
      { accountCode: expenseAccount, amount: total, type: 'debit' }
    ];

    // Add WHT if applicable
    let whtAccount = null;
    if (whtAmount > 0) {
      whtAccount = await Account.findOne({ companyId: req.user.companyId, code: '2250' }).session(session);
      if (!whtAccount) {
        whtAccount = new Account({
          companyId: req.user.companyId,
          code: '2250',
          name: 'WHT Payable (NRS)',
          type: 'Liability',
          balance: 0
        });
        await whtAccount.save({ session });
      }
      journalLines.push({ accountCode: whtAccount.code, amount: whtAmount, type: 'credit' });
      journalLines.push({ accountCode: apAccount.code, amount: netPayable, type: 'credit' });
    } else {
      journalLines.push({ accountCode: apAccount.code, amount: total, type: 'credit' });
    }

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date,
      description: `Bill ${billNumber} - ${isInventoryPurchase ? 'Inventory Purchase' : 'Expense'}`,
      type: 'bill',
      referenceType: 'bill',
      referenceId: bill._id,
      lines: journalLines
    });
    await journal.save({ session });

    // Update account balances
    expenseAccountDoc.balance += total;
    await expenseAccountDoc.save({ session });
    apAccount.balance += netPayable;
    await apAccount.save({ session });
    if (whtAccount && whtAmount > 0) {
      whtAccount.balance += whtAmount;
      await whtAccount.save({ session });
    }

    await session.commitTransaction();
    res.status(201).json(bill);
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

    if (bill.isInventoryPurchase) {
      for (const line of bill.lines) {
        if (line.productId) {
          const product = await Product.findById(line.productId).session(session);
          if (product && line.quantity > 0) {
            const oldStock = product.stock || 0;
            const oldCost = product.cost || 0;
            const unitCost = line.rate || 0;
            if (unitCost > 0) {
              const oldValue = oldStock * oldCost;
              const newValue = line.quantity * unitCost;
              product.cost = (oldValue + newValue) / (oldStock + line.quantity);
            }
            product.stock = oldStock + line.quantity;
            await product.save({ session });
          }
        }
      }
    }

    const apAccount = await Account.findOne({ companyId: req.user.companyId, code: '2000' }).session(session);
    const expenseAccountDoc = await Account.findOne({ companyId: req.user.companyId, code: bill.expenseAccount }).session(session);
    if (!apAccount || !expenseAccountDoc) throw new Error('Required accounts not found');

    const journalLines = [{ accountCode: bill.expenseAccount, amount: bill.total, type: 'debit' }];
    let whtAccount = null;
    if (bill.whtAmount > 0) {
      whtAccount = await Account.findOne({ companyId: req.user.companyId, code: '2250' }).session(session);
      if (whtAccount) {
        journalLines.push({ accountCode: whtAccount.code, amount: bill.whtAmount, type: 'credit' });
        journalLines.push({ accountCode: apAccount.code, amount: bill.netPayable, type: 'credit' });
      }
    } else {
      journalLines.push({ accountCode: apAccount.code, amount: bill.total, type: 'credit' });
    }

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date: bill.date,
      description: `Bill ${bill.number} - Approved (${bill.isInventoryPurchase ? 'Inventory Purchase' : 'Expense'})`,
      type: 'bill',
      referenceType: 'bill',
      referenceId: bill._id,
      lines: journalLines
    });
    await journal.save({ session });

    expenseAccountDoc.balance += bill.total;
    await expenseAccountDoc.save({ session });
    apAccount.balance += bill.netPayable;
    await apAccount.save({ session });
    if (whtAccount && bill.whtAmount > 0) {
      whtAccount.balance += bill.whtAmount;
      await whtAccount.save({ session });
    }

    bill.approvalStatus = 'approved';
    await bill.save({ session });

    await session.commitTransaction();
    res.json(bill);
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

    const remaining = bill.total - bill.amountPaid;
    const paidAmount = Math.min(amount, remaining);
    
    bill.payments.push({ date, amount: paidAmount });
    bill.amountPaid += paidAmount;
    bill.balance = bill.total - bill.amountPaid;
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