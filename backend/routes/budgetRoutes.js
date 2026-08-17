const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const budgetController = require('../controllers/budgetController');

router.get('/', authenticateToken, budgetController.getAll);
router.post('/', authenticateToken, budgetController.create);
router.delete('/:id', authenticateToken, requireRole('admin', 'accountant'), budgetController.delete);

module.exports = router;