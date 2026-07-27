const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const bankController = require('../controllers/bankController');

// Mount this router at /api/banktransactions in your main server file:
//   app.use('/api/banktransactions', require('./routes/bankTransactionRoutes'));
router.get('/', authenticateToken, bankController.getBankTransactions);
router.post('/', authenticateToken, bankController.createBankTransaction);

// Specific routes before the parameterized one, as good practice —
// though '/reconcile/bulk' and '/:id/reconcile' don't actually collide here.
router.patch('/reconcile/bulk', authenticateToken, bankController.bulkReconcileTransactions);
router.patch('/:id/reconcile', authenticateToken, bankController.reconcileTransaction);

module.exports = router;
