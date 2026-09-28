const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const purchaseOrderController = require('../controllers/purchaseOrderController');
const validate = require('../middleware/validate');
const V = require('../middleware/validators');

router.get('/', authenticateToken, purchaseOrderController.getAll);
router.get('/:id', authenticateToken, purchaseOrderController.getOne);
router.post('/', authenticateToken, requireRole('admin', 'accountant'), V.purchaseOrderCreate, validate, purchaseOrderController.create);
router.put('/:id', authenticateToken, requireRole('admin', 'accountant'), V.purchaseOrderCreate, validate, purchaseOrderController.update);
router.put('/:id/approve', authenticateToken, requireRole('admin'), purchaseOrderController.approve);
router.put('/:id/reject', authenticateToken, requireRole('admin'), purchaseOrderController.reject);
router.delete('/:id', authenticateToken, requireRole('admin', 'accountant'), purchaseOrderController.delete);
router.post('/:id/convert', authenticateToken, requireRole('admin', 'accountant'), V.purchaseOrderConvert, validate, purchaseOrderController.convertToBill);

module.exports = router;
