const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const exchangeController = require('../controllers/exchangeController');

router.get('/', authenticateToken, exchangeController.getRates);

module.exports = router;
