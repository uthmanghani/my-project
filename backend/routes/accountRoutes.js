const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const accountController = require('../controllers/accountController');

router.get('/', authenticateToken, accountController.getAll);
router.post('/', authenticateToken, accountController.create);
router.put('/opening-balance', authenticateToken, accountController.updateOpeningBalance);
router.delete('/:id', authenticateToken, requireRole('admin'), accountController.delete);

module.exports = router;