const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const journalController = require('../controllers/journalController');

router.get('/', authenticateToken, journalController.getAll);
router.post('/', authenticateToken, journalController.create);
router.delete('/:id', authenticateToken, journalController.delete);

module.exports = router;