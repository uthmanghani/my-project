const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const quoteController = require('../controllers/quoteController');

router.get('/', authenticateToken, quoteController.getAll);
router.get('/:id', authenticateToken, quoteController.getOne);
router.post('/', authenticateToken, requireRole('admin', 'accountant'), quoteController.create);
router.put('/:id', authenticateToken, requireRole('admin', 'accountant'), quoteController.update);
router.delete('/:id', authenticateToken, requireRole('admin', 'accountant'), quoteController.delete);
router.put('/:id/send', authenticateToken, requireRole('admin', 'accountant'), quoteController.send);
router.put('/:id/response', authenticateToken, requireRole('admin', 'accountant'), quoteController.setResponse);
router.post('/:id/convert', authenticateToken, requireRole('admin', 'accountant'), quoteController.convertToInvoice);

module.exports = router;
