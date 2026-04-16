const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const exportImportController = require('../controllers/exportImportController');

router.get('/export', authenticateToken, exportImportController.exportData);
router.post('/import', authenticateToken, exportImportController.importData);

module.exports = router;