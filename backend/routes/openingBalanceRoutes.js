const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const openingBalanceController = require('../controllers/openingBalanceController');

router.get('/', authenticateToken, openingBalanceController.getOpeningBalances);
router.put('/', authenticateToken, requireRole('admin', 'accountant'), openingBalanceController.setOpeningBalances);

module.exports = router;