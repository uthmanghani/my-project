const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  legalName: String,
  rcNumber: String,
  tin: String,
  phone: String,
  email: String,
  address: String,
  industry: {
    type: String,
    required: true
  },
  settings: {
    invoicePrefix: { type: String, default: 'INV-' },
    nextInvoiceNumber: { type: Number, default: 1 },
    defaultDueDays: { type: Number, default: 30 },
    defaultVatRate: { type: Number, default: 7.5 },
    defaultInvoiceNotes: { type: String, default: 'Thank you for your business.' },
    invoiceTemplate: { type: String, enum: ['classic', 'modern', 'minimal'], default: 'classic' },
    darkMode: { type: Boolean, default: false },
    currency: { type: String, default: '₦' },
    // Was collected client-side (uploadCompanyLogo) and written to
    // localStorage, but never sent to the server at all -- saveSettings()
    // didn't include it in its request body, and even if it had, this
    // field didn't exist here for Mongoose to save. It looked like it
    // worked (an instant local preview), but never persisted: a different
    // device, browser, or a cleared cache always showed no logo, and every
    // printed invoice generated anywhere but that one browser was affected.
    // Same data: URI validation as Bill/Invoice attachments, for the same
    // reason -- an <img src> is a real render sink.
    companyLogo: {
      type: String,
      default: '',
      maxlength: [3000000, 'Logo file is too large'],
      validate: {
        validator: v => !v || /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(v),
        message: 'companyLogo must be an image encoded as a base64 data: URI'
      }
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // Period closing/locking — these were referenced by companyController.js
  // but never actually existed in this schema, meaning Mongoose silently
  // stripped them on every save. Year-end closing never actually persisted
  // a lock even when it appeared to succeed.
  closedYears: [{ type: Number }],
  lockedUntilDate: { type: Date, default: null },
  lastClosingDate: { type: Date, default: null },
  // Controlled reopening (required alongside period locking) — every
  // reopen is recorded with who did it, when, and why, so locking a
  // period stays meaningful rather than being trivially bypassable.
  reopenHistory: [{
    reopenedAt: { type: Date, default: Date.now },
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    previousLockDate: Date
  }],
  // Bill maker-checker approval threshold — referenced by billController.js
  // since the approval workflow was built, but never added here either.
  approvalThreshold: { type: Number, default: 500000 },

  // NTA 2025 "Small Company" status (Section 56 / Section 202) — self-
  // declared, since AccounTrack can't independently verify turnover or
  // fixed asset value. When true: CIT/CGT/Development Levy exempt, and
  // VAT should not be charged or filed. Thresholds are stored (not
  // hardcoded) because even professional tax publications reported
  // conflicting figures for these thresholds during initial rollout —
  // keep them user-editable so a correction never requires a code change.
  taxStatus: {
    isSmallCompany: { type: Boolean, default: false },
    isProfessionalServices: { type: Boolean, default: false }, // excluded from small-company relief regardless of size
    smallCompanyTurnoverThreshold: { type: Number, default: 100000000 },   // ₦100,000,000 — NTA 2025 s.56/202
    smallCompanyFixedAssetThreshold: { type: Number, default: 250000000 }, // ₦250,000,000 — NTA 2025 s.56/202
    whtDeMinimisThreshold: { type: Number, default: 2000000 }              // ₦2,000,000 — WHT exemption for low-value payments
  }
});

module.exports = mongoose.model('Company', CompanySchema);