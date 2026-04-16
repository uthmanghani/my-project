const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const billController = require('../controllers/billController');

router.get('/', authenticateToken, billController.getAll);
router.get('/:id', authenticateToken, billController.getOne);
router.post('/', authenticateToken, billController.create);
router.put('/:id', authenticateToken, billController.update);
router.put('/:id/pay', authenticateToken, billController.recordPayment);
router.delete('/:id', authenticateToken, billController.delete);

module.exports = router;