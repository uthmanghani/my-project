const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const vendorController = require('../controllers/vendorController');

router.get('/', authenticateToken, vendorController.getAll);
router.get('/:id', authenticateToken, vendorController.getOne);
router.post('/', authenticateToken, vendorController.create);
router.put('/:id', authenticateToken, vendorController.update);
router.delete('/:id', authenticateToken, requireRole('admin', 'accountant'), vendorController.delete);

module.exports = router;