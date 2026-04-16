const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const paymentController = require('../controllers/paymentController');

router.get('/customer', authenticateToken, paymentController.getCustomerPayments);
router.get('/vendor', authenticateToken, paymentController.getVendorPayments);

module.exports = router;