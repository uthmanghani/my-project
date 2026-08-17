const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const companyController = require('../controllers/companyController');

router.get('/settings', authenticateToken, companyController.getSettings);
router.put('/settings', authenticateToken, companyController.updateSettings);
router.get('/profile', authenticateToken, companyController.getProfile);
router.delete('/clear', authenticateToken, requireRole('admin'), companyController.clearCompanyData);
router.post('/close-year', authenticateToken, requireRole('admin'), companyController.closeYear);
router.post('/reopen-period', authenticateToken, requireRole('admin'), companyController.reopenPeriod);

module.exports = router;