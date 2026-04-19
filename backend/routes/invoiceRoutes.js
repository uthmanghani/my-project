const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const invoiceController = require('../controllers/invoiceController');

router.get('/', authenticateToken, invoiceController.getAll);
router.get('/:id', authenticateToken, invoiceController.getOne);
router.post('/', authenticateToken, invoiceController.create);
router.put('/:id', authenticateToken, invoiceController.update);
router.put('/:id/pay', authenticateToken, invoiceController.recordPayment);
router.delete('/:id', authenticateToken, invoiceController.delete);

router.post('/:id/send-email', authenticateToken, invoiceController.sendEmail);
router.post('/:id/credit-note', authenticateToken, invoiceController.issueCreditNote);
 
module.exports = router;
