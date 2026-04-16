const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Export all company data as JSON
exports.exportData = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const models = {
      accounts: require('../models/Account'),
      customers: require('../models/Customer'),
      vendors: require('../models/Vendor'),
      products: require('../models/Product'),
      invoices: require('../models/Invoice'),
      bills: require('../models/Bill'),
      journalEntries: require('../models/JournalEntry'),
      employees: require('../models/Employee'),
      assets: require('../models/Asset'),
      budgets: require('../models/Budget'),
      payments: require('../models/Payment'),
      bankTransactions: require('../models/BankTransaction'),
      bankAccounts: require('../models/BankAccount'),
      auditLogs: require('../models/AuditLog')
    };
    const data = {};
    for (const [key, Model] of Object.entries(models)) {
      data[key] = await Model.find({ companyId }).lean();
    }
    // Also export company settings
    const Company = require('../models/Company');
    const company = await Company.findById(companyId).lean();
    data.company = company;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Import data (replace all existing company data)
exports.importData = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const data = req.body;
    const companyId = req.user.companyId;

    // Delete existing data
    const models = {
      accounts: require('../models/Account'),
      customers: require('../models/Customer'),
      vendors: require('../models/Vendor'),
      products: require('../models/Product'),
      invoices: require('../models/Invoice'),
      bills: require('../models/Bill'),
      journalEntries: require('../models/JournalEntry'),
      employees: require('../models/Employee'),
      assets: require('../models/Asset'),
      budgets: require('../models/Budget'),
      payments: require('../models/Payment'),
      bankTransactions: require('../models/BankTransaction'),
      bankAccounts: require('../models/BankAccount'),
      auditLogs: require('../models/AuditLog')
    };
    for (const Model of Object.values(models)) {
      await Model.deleteMany({ companyId }).session(session);
    }

    // Insert new data
    for (const [key, Model] of Object.entries(models)) {
      if (data[key] && Array.isArray(data[key])) {
        for (const doc of data[key]) {
          delete doc._id; // let MongoDB generate new _id
          doc.companyId = companyId;
          const newDoc = new Model(doc);
          await newDoc.save({ session });
        }
      }
    }
    // Update company settings
    if (data.company) {
      const Company = require('../models/Company');
      await Company.findByIdAndUpdate(companyId, data.company, { session });
    }

    await session.commitTransaction();
    res.json({ message: 'Data imported successfully' });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};