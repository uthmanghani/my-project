const Invoice = require('../models/Invoice');
const JournalEntry = require('../models/JournalEntry');
const Product = require('../models/Product');
const Account = require('../models/Account');
const Payment = require('../models/Payment');
const Company = require('../models/Company');
const BankAccount = require('../models/BankAccount');
const BankTransaction = require('../models/BankTransaction');
const mongoose = require('mongoose');
const { reverseAllEntriesFor } = require('../utils/journalReversal');
const { logAudit } = require('../utils/auditLog');
const { createAndPostInvoice } = require('../utils/invoicePosting');

exports.getAll = async (req, res) => {
  try {
    const invoices = await Invoice.find({ companyId: req.user.companyId })
      .populate('customerId', 'name email')
      .sort({ date: -1 });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      companyId: req.user.companyId,
      _id: req.params.id
    }).populate('customerId', 'name email');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const invoice = await createAndPostInvoice({
      companyId: req.user.companyId,
      data: req.body,
      session
    });
    await logAudit(req, 'INVOICE_CREATED', `Created Invoice ${invoice.number} — ₦${invoice.total.toLocaleString()}`, session);
    await session.commitTransaction();
    res.status(201).json(invoice);
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

exports.update = async (req, res) => {
  try {
    const invoice = await Invoice.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.recordPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { amount, date, bankCode } = req.body;
    const invoice = await Invoice.findById(req.params.id).session(session);
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === 'paid') throw new Error('Invoice already fully paid');

    const remaining = invoice.total - invoice.amountPaid;
    const paidAmount = Math.min(amount, remaining);
    invoice.payments.push({ date, amount: paidAmount });
    invoice.amountPaid += paidAmount;
    invoice.balance = invoice.total - invoice.amountPaid;
    if (invoice.balance <= 0.005) invoice.status = 'paid';
    else if (invoice.amountPaid > 0.005) invoice.status = 'partial';
    await invoice.save({ session });

    const cashAccount = await Account.findOne({ companyId: req.user.companyId, code: bankCode || '1000' }).session(session);
    const arAccount = await Account.findOne({ companyId: req.user.companyId, code: '1100' }).session(session);
    if (!cashAccount || !arAccount) throw new Error('Required accounts not found');

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date,
      description: `Payment received for ${invoice.number}`,
      type: 'payment',
      referenceType: 'invoice',
      referenceId: invoice._id,
      lines: [
        { accountCode: cashAccount.code, amount: paidAmount, type: 'debit' },
        { accountCode: arAccount.code, amount: paidAmount, type: 'credit' }
      ]
    });
    await journal.save({ session });

    cashAccount.balance += paidAmount;
    arAccount.balance -= paidAmount;
    await cashAccount.save({ session });
    await arAccount.save({ session });

    const paymentRecord = new Payment({
      companyId: req.user.companyId,
      type: 'customer',
      entityId: invoice.customerId,
      invoiceId: invoice._id,
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
        type: 'credit', // money coming into the bank from a customer
        amount: paidAmount,
        description: `Payment received - Invoice ${invoice.number}`,
        reference: invoice.number,
        reconciled: false
      });
      await bankTx.save({ session });
    }

    await session.commitTransaction();
    res.json(invoice);
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};

exports.sendEmail = async (req, res) => {
  try {
    const { sendInvoiceEmail } = require('../utils/emailService');
    const Customer = require('../models/Customer');
    const Company = require('../models/Company');
    const invoice = await Invoice.findOne({ companyId: req.user.companyId, _id: req.params.id })
      .populate('customerId');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const company = await Company.findById(req.user.companyId);
    const customer = invoice.customerId;
    await sendInvoiceEmail({
      to: customer.email,
      customerName: customer.name,
      invoiceNumber: invoice.number,
      amount: Number(invoice.total).toLocaleString('en-NG', { minimumFractionDigits: 2 }),
      dueDate: invoice.dueDate,
      companyName: company.name,
    });
    res.json({ message: 'Invoice emailed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
 
exports.issueCreditNote = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { amount, reason } = req.body;
    const invoice = await Invoice.findById(req.params.id).session(session);
    if (!invoice) throw new Error('Invoice not found');
    if (amount > invoice.total) throw new Error('Credit cannot exceed invoice total');
 
    const arAccount = await Account.findOne({ companyId: req.user.companyId, code: '1100' }).session(session);
    const revenueAccount = await Account.findOne({ companyId: req.user.companyId, code: '4000' }).session(session);
    if (!arAccount || !revenueAccount) throw new Error('Required accounts not found');
 
    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date: new Date(),
      description: `Credit Note for ${invoice.number} — ${reason}`,
      type: 'credit_note',
      referenceType: 'invoice',
      referenceId: invoice._id,
      lines: [
        { accountCode: revenueAccount.code, amount, type: 'debit' },
        { accountCode: arAccount.code, amount, type: 'credit' }
      ]
    });
    await journal.save({ session });
    arAccount.balance -= amount;
    revenueAccount.balance -= amount;
    await arAccount.save({ session });
    await revenueAccount.save({ session });
 
    invoice.creditNoteAmount = (invoice.creditNoteAmount || 0) + amount;
    invoice.creditNoteReason = reason;
    if (invoice.creditNoteAmount >= invoice.total) invoice.status = 'credit_note';
    await invoice.save({ session });
 
    await session.commitTransaction();
    res.json({ message: 'Credit note issued', creditNoteAmount: invoice.creditNoteAmount });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};
 
exports.delete = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const invoice = await Invoice.findOne({
      companyId: req.user.companyId,
      _id: req.params.id
    }).session(session);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.voided) return res.status(400).json({ error: 'This invoice has already been voided' });
    if (invoice.amountPaid > 0.005) {
      return res.status(400).json({
        error: 'This invoice has payments applied. Reverse or delete those payments before voiding the invoice.'
      });
    }

    // Reverse every journal entry this invoice posted (AR/Revenue/VAT, plus
    // any per-line COGS entries) — correctly restores account balances,
    // unlike the previous behavior which deleted the entries but left the
    // balances they'd changed permanently wrong.
    await reverseAllEntriesFor({
      referenceType: 'invoice',
      referenceId: invoice._id,
      companyId: req.user.companyId,
      userId: req.user.userId,
      reason: req.body.reason,
      session
    });

    // Restore stock for any stocked lines. As with bill voiding, this
    // restores quantity exactly but doesn't attempt to reconstruct the
    // exact pre-sale weighted-average cost.
    for (const line of invoice.lines) {
      if (line.productId) {
        const product = await Product.findById(line.productId).session(session);
        if (product) {
          product.stock = (product.stock || 0) + line.quantity;
          await product.save({ session });
        }
      }
    }

    invoice.voided = true;
    invoice.voidedAt = new Date();
    invoice.voidedBy = req.user.userId;
    invoice.voidReason = req.body.reason || null;
    await invoice.save({ session });

    await logAudit(req, 'INVOICE_VOIDED', `Voided Invoice ${invoice.number}${req.body.reason ? ' — ' + req.body.reason : ''}`, session);

    await session.commitTransaction();
    res.json({ message: 'Invoice voided. Journal entries reversed and stock restored.' });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};