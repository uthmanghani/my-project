const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const recurringBillingController = require('../controllers/recurringBillingController');
const validate = require('../middleware/validate');
const { body } = require('express-validator');

router.get('/', authenticateToken, recurringBillingController.getAll);

router.post('/', authenticateToken, requireRole('admin', 'accountant'), [
  body('name').notEmpty().withMessage('name is required'),
  body('type').isIn(['invoice', 'bill']).withMessage("type must be 'invoice' or 'bill'"),
  body('entityId').isMongoId().withMessage('entityId is not a valid id'),
  body('amount').isFloat({ gt: 0 }).withMessage('amount must be greater than 0').toFloat(),
  body('frequency').isIn(['weekly', 'monthly', 'quarterly', 'yearly']).withMessage('frequency is invalid'),
  body('nextDate').isISO8601().withMessage('nextDate must be a valid date').toDate(),
  body('endDate').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('endDate must be a valid date').toDate(),
  validate
], recurringBillingController.create);

router.put('/:id', authenticateToken, requireRole('admin', 'accountant'), recurringBillingController.update);
router.delete('/:id', authenticateToken, requireRole('admin', 'accountant'), recurringBillingController.delete);
router.post('/:id/run', authenticateToken, requireRole('admin', 'accountant'), recurringBillingController.run);

module.exports = router;
