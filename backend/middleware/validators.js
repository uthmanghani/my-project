const { body } = require('express-validator');

// Shared building blocks -----------------------------------------------
const money = (field, opts = {}) =>
  body(field)
    .exists({ checkFalsy: false }).withMessage(`${field} is required`)
    .bail()
    .isFloat({ min: opts.min ?? 0, ...(opts.gt !== undefined ? { gt: opts.gt } : {}) })
    .withMessage(`${field} must be a number${opts.gt !== undefined ? ' greater than 0' : ' >= 0'}`)
    .toFloat();

const dateField = (field, required = true) => {
  const chain = body(field);
  return (required ? chain.exists().withMessage(`${field} is required`).bail() : chain.optional())
    .isISO8601().withMessage(`${field} must be a valid date`).bail()
    .toDate();
};

const mongoId = (field, required = true) => {
  const chain = body(field);
  return (required ? chain.exists().withMessage(`${field} is required`).bail() : chain.optional({ nullable: true }))
    .isMongoId().withMessage(`${field} is not a valid id`);
};

// A bill/invoice line: needs a positive quantity and a non-negative rate and
// amount. Every quantity/rate/amount bug this app has hit so far (the
// products-don't-update bug, the depreciation double-post) came from the
// server trusting a number it never actually checked was a number.
const lineItems = (field) => [
  body(field).isArray({ min: 1 }).withMessage(`${field} must have at least one line`),
  body(`${field}.*.quantity`).isFloat({ gt: 0 }).withMessage('Each line quantity must be greater than 0').toFloat(),
  body(`${field}.*.rate`).isFloat({ min: 0 }).withMessage('Each line rate must be 0 or greater').toFloat(),
  body(`${field}.*.amount`).isFloat({ min: 0 }).withMessage('Each line amount must be 0 or greater').toFloat(),
];

// Journal lines: each must say debit or credit and carry a positive amount;
// the whole entry must balance. Custom validator on the parent field runs
// after per-item checks and sees the coerced numbers, not raw strings.
const journalLines = [
  body('lines').isArray({ min: 2 }).withMessage('A journal entry needs at least two lines'),
  body('lines.*.accountCode').notEmpty().withMessage('Each line needs an accountCode'),
  body('lines.*.type').isIn(['debit', 'credit']).withMessage("Each line type must be 'debit' or 'credit'"),
  body('lines.*.amount').isFloat({ gt: 0 }).withMessage('Each line amount must be greater than 0').toFloat(),
  body('lines').custom((lines) => {
    if (!Array.isArray(lines)) return true; // caught by the isArray check above
    const dr = lines.filter(l => l.type === 'debit').reduce((s, l) => s + Number(l.amount || 0), 0);
    const cr = lines.filter(l => l.type === 'credit').reduce((s, l) => s + Number(l.amount || 0), 0);
    if (Math.abs(dr - cr) > 0.005) {
      throw new Error(`Journal entry does not balance: debits ${dr.toFixed(2)} vs credits ${cr.toFixed(2)}`);
    }
    return true;
  }),
];

module.exports = {
  billCreate: [
    mongoId('vendorId'),
    dateField('date'),
    dateField('dueDate', false),
    ...lineItems('lines'),
    money('total', { gt: 0 }),
    body('expenseAccount').notEmpty().withMessage('expenseAccount is required'),
    body('whtRate').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('whtRate must be between 0 and 100').toFloat(),
  ],
  billPay: [
    money('amount', { gt: 0 }),
    dateField('date', false),
  ],
  invoiceCreate: [
    mongoId('customerId'),
    dateField('date'),
    dateField('dueDate', false),
    ...lineItems('lines'),
    money('total', { gt: 0 }),
  ],
  invoicePay: [
    money('amount', { gt: 0 }),
    dateField('date', false),
  ],
  invoiceCreditNote: [
    money('amount', { gt: 0 }),
  ],
  journalCreate: [
    dateField('date'),
    body('description').notEmpty().withMessage('description is required'),
    ...journalLines,
  ],
  stockAdjust: [
    mongoId('productId'),
    body('quantity').isFloat({ gt: 0 }).withMessage('quantity must be greater than 0').toFloat(),
    body('type').isIn(['in', 'out']).withMessage("type must be 'in' or 'out'"),
  ],
  payrollSingle: [
    mongoId('employeeId'),
    dateField('date'),
    money('monthlyGross', { gt: 0 }),
    money('monthlyNet', { gt: 0 }),
    money('monthlyPAYE'),
    money('monthlyPension'),
  ],
  payrollRun: [
    body('month').isInt({ min: 1, max: 12 }).withMessage('month must be 1-12').toInt(),
    body('year').isInt({ min: 2000, max: 2100 }).withMessage('year is invalid').toInt(),
  ],
  accountCreate: [
    body('code').notEmpty().withMessage('code is required'),
    body('name').notEmpty().withMessage('name is required'),
    body('type').isIn(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']).withMessage('type is invalid'),
    body('openingBalance').optional({ nullable: true }).isFloat().withMessage('openingBalance must be a number').toFloat(),
  ],
  assetCreate: [
    body('name').notEmpty().withMessage('name is required'),
    dateField('purchaseDate'),
    money('purchaseCost', { gt: 0 }),
    body('usefulLifeYears').isFloat({ gt: 0 }).withMessage('usefulLifeYears must be greater than 0').toFloat(),
    body('residualValue').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('residualValue must be 0 or greater').toFloat(),
  ],
  budgetCreate: [
    body('accountCode').notEmpty().withMessage('accountCode is required'),
    body('year').isInt({ min: 2000, max: 2100 }).withMessage('year is invalid').toInt(),
    money('amount', { gt: 0 }),
  ],
  customerVendorCreate: [
    body('name').notEmpty().withMessage('name is required'),
    body('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('email is invalid'),
    body('openingBalance').optional({ nullable: true }).isFloat().withMessage('openingBalance must be a number').toFloat(),
  ],
  bankAccountCreate: [
    body('name').notEmpty().withMessage('name is required'),
    body('bank').notEmpty().withMessage('bank is required'),
    body('openingBalance').optional({ nullable: true }).isFloat().withMessage('openingBalance must be a number').toFloat(),
  ],
  bankTransactionCreate: [
    mongoId('bankId'),
    dateField('date'),
    body('type').isIn(['debit', 'credit']).withMessage("type must be 'debit' or 'credit'"),
    money('amount', { gt: 0 }),
    body('description').notEmpty().withMessage('description is required'),
  ],
  purchaseOrderCreate: [
    mongoId('vendorId'),
    dateField('date'),
    dateField('expectedDate', false),
    ...lineItems('lines'),
    money('total', { gt: 0 }),
  ],
  purchaseOrderConvert: [
    body('expenseAccount').notEmpty().withMessage('expenseAccount is required'),
    body('whtRate').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('whtRate must be between 0 and 100').toFloat(),
  ],
};
