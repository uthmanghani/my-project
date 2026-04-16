const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const customerController = require('../controllers/customerController');

router.get('/', authenticateToken, customerController.getAll);
router.get('/:id', authenticateToken, customerController.getOne);
router.post('/', authenticateToken, customerController.create);
router.put('/:id', authenticateToken, customerController.update);
router.delete('/:id', authenticateToken, customerController.delete);

module.exports = router;