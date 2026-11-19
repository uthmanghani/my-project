const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const accountController = require('../controllers/accountController');

router.get('/', authenticateToken, accountController.getAll);
router.post('/', authenticateToken, requireRole('admin', 'accountant'), accountController.create);
router.put('/opening-balance', authenticateToken, requireRole('admin', 'accountant'), accountController.updateOpeningBalance);
router.put('/:id/classification', authenticateToken, requireRole('admin', 'accountant'), accountController.updateClassification);
router.delete('/:id', authenticateToken, requireRole('admin'), accountController.delete);

module.exports = router;