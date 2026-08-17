const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const productController = require('../controllers/productController');

router.get('/', authenticateToken, productController.getAll);
router.get('/:id', authenticateToken, productController.getOne);
router.post('/', authenticateToken, productController.create);
router.put('/:id', authenticateToken, productController.update);
router.post('/adjust', authenticateToken, productController.adjustStock);
router.delete('/:id', authenticateToken, requireRole('admin', 'accountant'), productController.delete);

module.exports = router;