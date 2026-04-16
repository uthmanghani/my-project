const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const openingBalanceController = require('../controllers/openingBalanceController');

router.get('/', authenticateToken, openingBalanceController.getOpeningBalances);
router.put('/', authenticateToken, openingBalanceController.setOpeningBalances);

module.exports = router;