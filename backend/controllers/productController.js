const Product = require('../models/Product');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');
const mongoose = require('mongoose');

exports.getAll = async (req, res) => {
  try {
    const products = await Product.find({ companyId: req.user.companyId }).sort({ name: 1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const product = await Product.findOne({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const product = new Product({ ...req.body, companyId: req.user.companyId });
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.adjustStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { productId, quantity, type, reference } = req.body;
    const product = await Product.findById(productId).session(session);
    if (!product) throw new Error('Product not found');
    if (type === 'out' && product.stock < quantity) throw new Error('Insufficient stock');

    product.stock += (type === 'in' ? quantity : -quantity);
    await product.save({ session });

    const adjValue = quantity * product.cost;
    const inventoryAccount = await Account.findOne({ companyId: req.user.companyId, code: '1200' }).session(session);
    let adjAccount = await Account.findOne({ companyId: req.user.companyId, code: '6500' }).session(session);
    if (!adjAccount) {
      adjAccount = new Account({
        companyId: req.user.companyId,
        code: '6500',
        name: 'Inventory Adjustment Expense',
        type: 'Expense',
        balance: 0
      });
      await adjAccount.save({ session });
    }

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date: new Date(),
      description: `Stock adjustment - ${product.name} (${type === 'in' ? '+' : '-'}${quantity} units × ${product.cost})`,
      type: 'journal',
      lines: type === 'in'
        ? [
            { accountCode: inventoryAccount.code, amount: adjValue, type: 'debit' },
            { accountCode: adjAccount.code, amount: adjValue, type: 'credit' }
          ]
        : [
            { accountCode: adjAccount.code, amount: adjValue, type: 'debit' },
            { accountCode: inventoryAccount.code, amount: adjValue, type: 'credit' }
          ]
    });
    await journal.save({ session });

    inventoryAccount.balance += (type === 'in' ? adjValue : -adjValue);
    adjAccount.balance += (type === 'in' ? -adjValue : adjValue);
    await inventoryAccount.save({ session });
    await adjAccount.save({ session });

    await session.commitTransaction();
    res.json({ message: 'Stock adjusted', newStock: product.stock });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};