const Company = require('../models/Company');
const mongoose = require('mongoose');

// Get company settings
exports.getSettings = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    res.json({
      // Top-level fields — mapped to what frontend expects
      companyName:         company.name,
      companyLegalName:    company.legalName      || company.name,
      companyTaxId:        company.tin,
      companyPhone:        company.phone,
      companyEmail:        company.email,
      companyAddress:      company.address,
      rcNumber:            company.rcNumber,
      industry:            company.industry,

      // Settings sub-object
      invoicePrefix:       company.settings?.invoicePrefix       || 'INV-',
      nextInvoiceNumber:   company.settings?.nextInvoiceNumber   || 1,
      defaultDueDays:      company.settings?.defaultDueDays      || 30,
      defaultVatRate:      company.settings?.defaultVatRate       || 7.5,
      defaultInvoiceNotes: company.settings?.defaultInvoiceNotes || 'Thank you for your business.',
      currency:            company.settings?.currency             || '₦',
      darkMode:            company.settings?.darkMode             || false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update company settings
exports.updateSettings = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    company.settings = { ...company.settings, ...req.body };
    await company.save();
    res.json(company.settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get company profile
exports.getProfile = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json(company);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Clear all company data
exports.clearCompanyData = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const companyId = req.user.companyId;
    const models = [
      require('../models/Account'),
      require('../models/Customer'),
      require('../models/Vendor'),
      require('../models/Product'),
      require('../models/Invoice'),
      require('../models/Bill'),
      require('../models/JournalEntry'),
      require('../models/Employee'),
      require('../models/Asset'),
      require('../models/Budget'),
      require('../models/Payment'),
      require('../models/BankTransaction'),
      require('../models/BankAccount'),
      require('../models/AuditLog')
    ];
    for (const Model of models) {
      await Model.deleteMany({ companyId }).session(session);
    }
    await session.commitTransaction();
    res.json({ message: 'All company data cleared successfully' });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};