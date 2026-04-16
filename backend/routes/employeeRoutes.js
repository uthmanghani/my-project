const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const employeeController = require('../controllers/employeeController');

router.get('/', authenticateToken, employeeController.getAll);
router.post('/', authenticateToken, employeeController.create);
router.put('/:id', authenticateToken, employeeController.update);
router.delete('/:id', authenticateToken, employeeController.delete);
router.post('/payroll/run', authenticateToken, employeeController.runPayroll);

module.exports = router;