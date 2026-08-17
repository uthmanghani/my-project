const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const invoiceController = require('../controllers/invoiceController');

router.get('/', authenticateToken, invoiceController.getAll);
router.get('/:id', authenticateToken, invoiceController.getOne);
const { checkPeriodLock } = require('../middleware/periodLock');
router.post('/', authenticateToken, checkPeriodLock, invoiceController.create);
router.put('/:id', authenticateToken, invoiceController.update);
router.put('/:id/pay', authenticateToken, invoiceController.recordPayment);
router.delete('/:id', authenticateToken, requireRole('admin', 'accountant'), invoiceController.delete);

router.post('/:id/send-email', authenticateToken, invoiceController.sendEmail);
router.post('/:id/credit-note', authenticateToken, requireRole('admin', 'accountant'), invoiceController.issueCreditNote);
 
module.exports = router;
