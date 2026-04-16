const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const reportController = require('../controllers/reportController');

router.get('/profit-loss', authenticateToken, reportController.getProfitLoss);
router.get('/balance-sheet', authenticateToken, reportController.getBalanceSheet);
router.get('/trial-balance', authenticateToken, reportController.getTrialBalance);
router.get('/vat-summary', authenticateToken, reportController.getVATSummary);
router.get('/cash-flow', authenticateToken, reportController.getCashFlow);

module.exports = router;