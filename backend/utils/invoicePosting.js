const Invoice = require('../models/Invoice');
const JournalEntry = require('../models/JournalEntry');
const Product = require('../models/Product');
const Account = require('../models/Account');
const Company = require('../models/Company');

/**
 * Creates an invoice and posts its full accounting impact — AR/Revenue/VAT
 * journal entry, per-line COGS entries, and stock decrements — inside the
 * given session. This is the single source of truth for "what happens when
 * an invoice is created"; both the POST /invoices route and the recurring
 * invoice job call this, so they can never drift out of sync with each
 * other the way the old recurring job did (it bypassed all of this
 * entirely and just wrote a bare Invoice document with no ledger impact).
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {object} params.data - invoice fields (customerId, date, dueDate, lines, subtotal, vat, total, ...)
 * @param {import('mongoose').ClientSession} params.session - must be an active transaction session
 * @returns the created Invoice document
 */
async function createAndPostInvoice({ companyId, data, session }) {
  const company = await Company.findById(companyId).session(session);
  if (!company) throw new Error('Company not found');

  const invoiceNumber = company.settings.invoicePrefix +
    String(company.settings.nextInvoiceNumber).padStart(4, '0');
  company.settings.nextInvoiceNumber += 1;
  await company.save({ session });

  const invoiceData = { ...data, companyId, number: invoiceNumber };

  // NTA 2025: small companies (turnover ≤ threshold, not professional
  // services) don't charge or remit VAT at all — re-evaluated fresh at
  // generation time (not copied from a template), so a company's tax
  // status change is reflected in every future recurrence.
  const taxStatus = company.taxStatus || {};
  if (taxStatus.isSmallCompany && !taxStatus.isProfessionalServices) {
    invoiceData.vat = 0;
    invoiceData.total = invoiceData.subtotal || 0;
    invoiceData.balance = invoiceData.total;
  }

  const invoice = new Invoice(invoiceData);
  await invoice.save({ session });

  // Post journal entry
  const arAccount = await Account.findOne({ companyId, code: '1100' }).session(session);
  const revenueAccount = await Account.findOne({ companyId, code: '4000' }).session(session);
  const vatAccount = await Account.findOne({ companyId, code: '2100' }).session(session);
  if (!arAccount || !revenueAccount) throw new Error('Required accounts (AR/Revenue) not found');

  const lines = [
    { accountCode: arAccount.code, amount: invoice.total, type: 'debit' },
    { accountCode: revenueAccount.code, amount: invoice.subtotal, type: 'credit' }
  ];
  if (invoice.vat > 0 && vatAccount) {
    lines.push({ accountCode: vatAccount.code, amount: invoice.vat, type: 'credit' });
  }

  const journal = new JournalEntry({
    companyId,
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
        const cogsAccount = await Account.findOne({ companyId, code: '5000' }).session(session);
        const inventoryAccount = await Account.findOne({ companyId, code: product.inventoryAccountCode || '1200' }).session(session);
        if (!inventoryAccount) throw new Error(`Inventory account not found for ${product.name}`);
        const cost = product.cost * line.quantity;
        const cogsJournal = new JournalEntry({
          companyId,
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

  return invoice;
}

module.exports = { createAndPostInvoice };
