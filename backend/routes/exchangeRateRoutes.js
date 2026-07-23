const express = require('express');
const router = express.Router();
const exchangeRateController = require('../controllers/exchangeRateController');

router.get('/', exchangeRateController.getRates);

module.exports = router;
