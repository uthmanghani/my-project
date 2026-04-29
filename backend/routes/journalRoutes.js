const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const journalController = require('../controllers/journalController');

router.get('/', authenticateToken, journalController.getAll);
const { checkPeriodLock } = require('../middleware/periodLock');
router.post('/', authenticateToken, checkPeriodLock, journalController.create);
router.delete('/:id', authenticateToken, journalController.delete);

module.exports = router;