const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const bankController = require('../controllers/bankController');

router.get('/accounts', authenticateToken, bankController.getBankAccounts);
router.post('/accounts', authenticateToken, bankController.createBankAccount);
router.delete('/accounts/:id', authenticateToken, bankController.deleteBankAccount);
router.get('/transactions', authenticateToken, bankController.getBankTransactions);
router.post('/transactions', authenticateToken, bankController.createBankTransaction);

module.exports = router;