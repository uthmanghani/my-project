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
    currency: { type: String, default: '₦' }
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