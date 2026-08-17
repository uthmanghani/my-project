const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const journalController = require('../controllers/journalController');

router.get('/', authenticateToken, journalController.getAll);
const { checkPeriodLock } = require('../middleware/periodLock');
router.post('/', authenticateToken, checkPeriodLock, journalController.create);
// Voiding posts a reversing entry dated today, not a deletion — but the
// reversal itself must still respect period locks on today's date.
router.delete('/:id', authenticateToken, requireRole('admin', 'accountant'), checkPeriodLock, journalController.voidEntry);

module.exports = router;