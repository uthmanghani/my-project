const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const auditController = require('../controllers/auditController');

router.get('/', authenticateToken, auditController.getAll);
router.post('/', authenticateToken, auditController.logAction);
router.delete('/clear', authenticateToken, auditController.clear);

module.exports = router;