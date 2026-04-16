const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const assetController = require('../controllers/assetController');

router.get('/', authenticateToken, assetController.getAll);
router.post('/', authenticateToken, assetController.create);
router.post('/:id/depreciate', authenticateToken, assetController.postDepreciation);
router.delete('/:id', authenticateToken, assetController.delete);

module.exports = router;