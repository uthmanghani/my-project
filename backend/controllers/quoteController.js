const Quote = require('../models/Quote');
const Company = require('../models/Company');
const AppError = require('../utils/AppError');
const invoiceController = require('./invoiceController');
const { logAudit } = require('../utils/auditLog');

exports.getAll = async (req, res) => {
  try {
    const quotes = await Quote.find({ companyId: req.user.companyId })
      .populate('customerId', 'name email')
      .sort({ date: -1 });
    res.json(quotes);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.getOne = async (req, res) => {
  try {
    const quote = await Quote.findOne({ companyId: req.user.companyId, _id: req.params.id })
      .populate('customerId', 'name email');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Recomputes subtotal/VAT/total from the submitted lines rather than
// trusting whatever numbers the client sent, the same way a bill or
// invoice's figures shouldn't just be taken on faith — a quote has no
// journal entry riding on it, but its total still becomes the invoice's
// total the moment it's converted, and is what a customer sees printed.
// vatExempt mirrors invoiceController's NTA 2025 small-company rule: a
// small company that isn't a professional-services business never
// charges VAT, on quotes any more than on the invoice it becomes.
function computeTotals(lines, defaultVatRate, vatExempt) {
  let subtotal = 0, vat = 0;
  const normalizedLines = (lines || []).map(l => {
    const quantity = Number(l.quantity) || 0;
    const rate = Number(l.rate) || 0;
    const amount = parseFloat((quantity * rate).toFixed(2));
    const vatApplicable = !vatExempt && l.vatApplicable !== false;
    const vatRate = vatApplicable ? (Number(l.vatRate) || defaultVatRate || 0) : 0;
    const lineVat = parseFloat((amount * (vatRate / 100)).toFixed(2));
    subtotal += amount;
    vat += lineVat;
    return {
      productId: l.productId || null,
      description: l.description || 'Item',
      quantity, rate, amount, vatApplicable, vatRate, lineVat
    };
  });
  subtotal = parseFloat(subtotal.toFixed(2));
  vat = parseFloat(vat.toFixed(2));
  const total = parseFloat((subtotal + vat).toFixed(2));
  return { lines: normalizedLines, subtotal, vat, total };
}

exports.create = async (req, res) => {
  try {
    const { customerId, date, expiryDate, lines, notes, attachment } = req.body;
    if (!customerId) throw new AppError('customerId is required', 400);
    if (!date) throw new AppError('date is required', 400);

    const company = await Company.findById(req.user.companyId);
    const vatExempt = !!(company?.taxStatus?.isSmallCompany && !company?.taxStatus?.isProfessionalServices);
    const { lines: normalizedLines, subtotal, vat, total } =
      computeTotals(lines, company?.settings?.defaultVatRate ?? 7.5, vatExempt);
    if (total <= 0) throw new AppError('Quote total must be greater than zero', 400);

    // Same verify-actually-free numbering pattern used for invoices, bills
    // and purchase orders elsewhere in this codebase, rather than a bare
    // count+1 that drifts and collides under concurrent use.
    const yearPrefix = 'QUO-' + new Date().getFullYear() + '-';
    let candidateNum = (await Quote.countDocuments({ companyId: req.user.companyId })) + 1;
    let number = yearPrefix + String(candidateNum).padStart(4, '0');
    while (await Quote.findOne({ companyId: req.user.companyId, number })) {
      candidateNum += 1;
      number = yearPrefix + String(candidateNum).padStart(4, '0');
    }

    const quote = new Quote({
      companyId: req.user.companyId,
      number,
      customerId,
      date,
      expiryDate: expiryDate || null,
      lines: normalizedLines,
      subtotal, vat, total,
      notes,
      ...(attachment ? { attachment } : {}),
      status: 'draft'
    });
    await quote.save();
    await logAudit(req, 'QUOTE_CREATED', `Created Quote ${quote.number} — ₦${total.toLocaleString()}`);
    res.status(201).json(quote);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await Quote.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Quote not found' });
    if (existing.status === 'converted') {
      throw new AppError('This quote has already been converted to an invoice and can no longer be edited', 400);
    }
    const { customerId, date, expiryDate, lines, notes, attachment } = req.body;
    const company = await Company.findById(req.user.companyId);
    const vatExempt = !!(company?.taxStatus?.isSmallCompany && !company?.taxStatus?.isProfessionalServices);
    const { lines: normalizedLines, subtotal, vat, total } =
      computeTotals(lines, company?.settings?.defaultVatRate ?? 7.5, vatExempt);
    if (total <= 0) throw new AppError('Quote total must be greater than zero', 400);

    Object.assign(existing, {
      customerId, date, expiryDate: expiryDate || null,
      lines: normalizedLines, subtotal, vat, total, notes,
      ...(attachment ? { attachment } : {})
    });
    // Editing a quote a customer has already responded to would silently
    // misrepresent what they actually agreed to or turned down — force it
    // back to draft so it's clear this is a new version to be re-sent.
    if (existing.status === 'accepted' || existing.status === 'declined' || existing.status === 'expired') {
      existing.status = 'draft';
    }
    await existing.save();
    res.json(existing);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.delete = async (req, res) => {
  try {
    const quote = await Quote.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (quote.status === 'converted') {
      throw new AppError('This quote has already been converted to an invoice and cannot be deleted', 400);
    }
    await Quote.deleteOne({ _id: quote._id, companyId: req.user.companyId });
    res.json({ message: 'Quote deleted' });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Marks a quote sent — a plain status change; nothing is posted anywhere.
exports.send = async (req, res) => {
  try {
    const quote = await Quote.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (quote.status === 'converted') {
      throw new AppError('This quote has already been converted to an invoice', 400);
    }
    quote.status = 'sent';
    await quote.save();
    res.json(quote);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// There's no customer-facing portal in this app yet, so acceptance/decline
// is recorded by staff based on the customer's response (a phone call, an
// email reply, a signed copy) rather than a link the customer clicks
// themselves — same manual-entry model as recording a bank transaction.
exports.setResponse = async (req, res) => {
  try {
    const { response } = req.body; // 'accepted' | 'declined'
    if (!['accepted', 'declined'].includes(response)) {
      throw new AppError("response must be 'accepted' or 'declined'", 400);
    }
    const quote = await Quote.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (quote.status === 'converted') {
      throw new AppError('This quote has already been converted to an invoice', 400);
    }
    quote.status = response;
    await quote.save();
    res.json(quote);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Converts an accepted quote into a real Invoice by calling
// invoiceController.create internally — the exact same pattern
// purchaseOrderController.convertToBill already uses for POs, so this
// inherits every fix already made to invoice posting (VAT/small-company
// handling, stock, e-invoicing fields) for free, and stays that way if
// invoiceController changes again later, rather than re-implementing
// (and re-risking) that logic here.
exports.convertToInvoice = async (req, res) => {
  try {
    const quote = await Quote.findOne({ companyId: req.user.companyId, _id: req.params.id });
    if (!quote) throw new AppError('Quote not found', 404);
    if (quote.status === 'converted') {
      throw new AppError('This quote has already been converted to an invoice', 400);
    }
    if (quote.status === 'declined' || quote.status === 'expired') {
      throw new AppError(`This quote was ${quote.status} and cannot be converted. Edit it to create a fresh draft first.`, 400);
    }
    const { dueDate } = req.body;
    // Invoice.dueDate is required — a quote has no due date concept of its
    // own, so default to the company's normal invoice payment terms rather
    // than passing null through and failing Invoice's schema validation.
    const company = await Company.findById(req.user.companyId);
    const dueDays = company?.settings?.defaultDueDays ?? 30;
    const resolvedDueDate = dueDate || new Date(Date.now() + dueDays * 86400000);

    const innerReq = {
      user: req.user,
      body: {
        customerId: quote.customerId,
        date: new Date(),
        dueDate: resolvedDueDate,
        lines: quote.lines,
        subtotal: quote.subtotal,
        vat: quote.vat,
        total: quote.total,
        notes: quote.notes,
        status: 'unpaid', payments: [], amountPaid: 0, balance: quote.total,
        einvoiceStatus: 'not_required', irn: null, csid: null, qrCode: null
      }
    };
    let created = null, errorBody = null, statusCode = 200;
    const innerRes = {
      status(c) { statusCode = c; return this; },
      json(body) {
        if (statusCode >= 200 && statusCode < 300) created = body;
        else errorBody = body;
        return this;
      }
    };
    await invoiceController.create(innerReq, innerRes);
    if (!created) {
      return res.status(statusCode || 500).json(errorBody || { error: 'Failed to create an invoice from this quote' });
    }

    quote.status = 'converted';
    quote.convertedInvoiceId = created._id;
    quote.convertedAt = new Date();
    await quote.save();

    res.json({ message: 'Quote converted to invoice', invoice: created, quote });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
