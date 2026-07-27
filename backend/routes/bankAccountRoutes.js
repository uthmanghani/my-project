const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const bankController = require('../controllers/bankController');

// Mount this router at /api/bankaccounts in your main server file:
//   app.use('/api/bankaccounts', require('./routes/bankAccountRoutes'));
router.get('/', authenticateToken, bankController.getBankAccounts);
router.post('/', authenticateToken, bankController.createBankAccount);
router.delete('/:id', authenticateToken, bankController.deleteBankAccount);

module.exports = router;
