const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');
const mongoose = require('mongoose');
const { logAudit } = require('../utils/auditLog');

exports.getAll = async (req, res) => {
  try {
    const products = await Product.find({ companyId: req.user.companyId, isActive: { $ne: false } }).sort({ name: 1 });
    res.json(products);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Picks the right inventory GL account for a product based on its item
// type, so Raw Materials and Finished Goods can post to separate accounts
// instead of always sharing '1200'. Falls back sensibly if the company's
// Chart of Accounts doesn't have a dedicated account for that item type yet.
async function resolveInventoryAccountCode(companyId, itemType) {
  const nameTest = itemType === 'raw_material'
    ? /raw material/i
    : /finished goods/i;
  let match = await Account.findOne({ companyId, type: 'Asset', name: nameTest });
  if (!match) match = await Account.findOne({ companyId, type: 'Asset', name: /inventory|stock/i });
  return match ? match.code : '1200';
}

exports.create = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const itemType = req.body.itemType || 'finished_good';
    const inventoryAccountCode = req.body.inventoryAccountCode
      || await resolveInventoryAccountCode(req.user.companyId, itemType);
    const product = new Product({ ...req.body, itemType, inventoryAccountCode, companyId: req.user.companyId });
    await product.save({ session });

    // Auto-post opening stock value to its linked ledger account — without
    // this, a product's Opening Stock quantity/cost only ever existed on
    // the Product document itself, with zero connection to the actual
    // Inventory account in the Chart of Accounts. Matches how creating a
    // Bank Account already auto-sets its linked ledger account's balance.
    const openingValue = (product.stock || 0) * (product.cost || 0);
    if (openingValue > 0) {
      const inventoryAccount = await Account.findOne({ companyId: req.user.companyId, code: inventoryAccountCode }).session(session);
      if (inventoryAccount) {
        inventoryAccount.balance += openingValue;
        inventoryAccount.openingBalance = (inventoryAccount.openingBalance || 0) + openingValue;
        await inventoryAccount.save({ session });
      }
    }

    await logAudit(req, 'PRODUCT_CREATED', `Created product ${product.name}${openingValue > 0 ? ` with opening stock value ₦${openingValue.toLocaleString()}` : ''}`, session);

    await session.commitTransaction();
    res.status(201).json(product);
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    session.endSession();
  }
};

exports.update = async (req, res) => {
  try {
    // context: 'query' is required for the conditional `required` on price
    // (itemType !== 'raw_material') to evaluate correctly during an update —
    // without it, Mongoose validators can't see sibling fields properly.
    const product = await Product.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      req.body,
      { new: true, runValidators: true, context: 'query' }
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.delete = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      { isActive: false },
      { new: true }
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });
    await logAudit(req, 'PRODUCT_DEACTIVATED', `Deactivated product ${product.name}`);
    res.json({ message: 'Product deactivated' });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.adjustStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { productId, quantity, type, reference } = req.body;
    // SECURITY: was Product.findById with no companyId check â any user of
    // ANY company could adjust another company's stock and inventory balance.
    const product = await Product.findOne({ _id: productId, companyId: req.user.companyId }).session(session);
    if (!product) throw new AppError('Product not found', 404);
    if (type === 'out' && product.stock < quantity) throw new AppError('Insufficient stock', 400);

    product.stock += (type === 'in' ? quantity : -quantity);
    await product.save({ session });

    const adjValue = quantity * product.cost;
    const inventoryAccount = await Account.findOne({ companyId: req.user.companyId, code: product.inventoryAccountCode || '1200' }).session(session);
    if (!inventoryAccount) throw new AppError('Inventory account not found for this product', 400);
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

    await logAudit(req, 'STOCK_ADJUSTED', `${type === 'in' ? 'Increased' : 'Decreased'} stock for ${product.name} by ${quantity} units${reference ? ' — ' + reference : ''} (posted against Inventory Adjustments, not AP/Cash — use Enter Bill for actual purchases)`, session);

    await session.commitTransaction();
    res.json({ message: 'Stock adjusted', newStock: product.stock });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    session.endSession();
  }
};