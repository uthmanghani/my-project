const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const payrollController = require('../controllers/payrollController');

router.post('/single', authenticateToken, payrollController.recordSinglePayroll);
router.post('/run', authenticateToken, payrollController.runBatchPayroll);

module.exports = router;