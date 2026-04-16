const Invoice = require('../models/Invoice');
const JournalEntry = require('../models/JournalEntry');
const Product = require('../models/Product');
const Account = require('../models/Account');
const Payment = require('../models/Payment');
const Company = require('../models/Company');
const mongoose = require('mongoose');

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
    const company = await Company.findById(req.user.companyId).session(session);
    const invoiceNumber = company.settings.invoicePrefix +
      String(company.settings.nextInvoiceNumber).padStart(4, '0');
    company.settings.nextInvoiceNumber += 1;
    await company.save({ session });

    const invoiceData = { ...req.body, companyId: req.user.companyId, number: invoiceNumber };
    const invoice = new Invoice(invoiceData);
    await invoice.save({ session });

    // Post journal entry
    const arAccount = await Account.findOne({ companyId: req.user.companyId, code: '1100' }).session(session);
    const revenueAccount = await Account.findOne({ companyId: req.user.companyId, code: '4000' }).session(session);
    const vatAccount = await Account.findOne({ companyId: req.user.companyId, code: '2100' }).session(session);

    const lines = [
      { accountCode: arAccount.code, amount: invoice.total, type: 'debit' },
      { accountCode: revenueAccount.code, amount: invoice.subtotal, type: 'credit' }
    ];
    if (invoice.vat > 0 && vatAccount) {
      lines.push({ accountCode: vatAccount.code, amount: invoice.vat, type: 'credit' });
    }

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date: invoice.date,
      description: `Invoice ${invoice.number}`,
      type: 'invoice',
      referenceType: 'invoice',
      referenceId: invoice._id,
      lines
    });
    await journal.save({ session });

    // Update inventory and post COGS
    for (const line of invoice.lines) {
      if (line.productId) {
        const product = await Product.findById(line.productId).session(session);
        if (product) {
          if (product.stock < line.quantity) throw new Error(`Insufficient stock for ${product.name}`);
          product.stock -= line.quantity;
          await product.save({ session });
          const cogsAccount = await Account.findOne({ companyId: req.user.companyId, code: '5000' }).session(session);
          const inventoryAccount = await Account.findOne({ companyId: req.user.companyId, code: '1200' }).session(session);
          const cost = product.cost * line.quantity;
          const cogsJournal = new JournalEntry({
            companyId: req.user.companyId,
            date: invoice.date,
            description: `COGS - ${product.name} (${invoice.number})`,
            type: 'cogs',
            referenceType: 'invoice',
            referenceId: invoice._id,
            lines: [
              { accountCode: cogsAccount.code, amount: cost, type: 'debit' },
              { accountCode: inventoryAccount.code, amount: cost, type: 'credit' }
            ]
          });
          await cogsJournal.save({ session });
          cogsAccount.balance += cost;
          inventoryAccount.balance -= cost;
          await cogsAccount.save({ session });
          await inventoryAccount.save({ session });
        }
      }
    }

    arAccount.balance += invoice.total;
    revenueAccount.balance += invoice.subtotal;
    if (vatAccount && invoice.vat > 0) vatAccount.balance += invoice.vat;
    await arAccount.save({ session });
    await revenueAccount.save({ session });
    if (vatAccount && invoice.vat > 0) await vatAccount.save({ session });

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

    await session.commitTransaction();
    res.json(invoice);
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
    const invoice = await Invoice.findOneAndDelete({
      companyId: req.user.companyId,
      _id: req.params.id
    }).session(session);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    await JournalEntry.deleteMany({
      companyId: req.user.companyId,
      referenceType: 'invoice',
      referenceId: invoice._id
    }).session(session);
    await session.commitTransaction();
    res.json({ message: 'Invoice deleted' });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};