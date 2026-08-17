const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const employeeController = require('../controllers/employeeController');

router.get('/', authenticateToken, employeeController.getAll);
router.post('/', authenticateToken, employeeController.create);
router.put('/:id', authenticateToken, employeeController.update);
router.delete('/:id', authenticateToken, requireRole('admin', 'accountant'), employeeController.delete);
router.post('/payroll/run', authenticateToken, requireRole('admin', 'accountant'), employeeController.runPayroll);

module.exports = router;