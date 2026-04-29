const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const companyController = require('../controllers/companyController');

router.get('/settings', authenticateToken, companyController.getSettings);
router.put('/settings', authenticateToken, companyController.updateSettings);
router.get('/profile', authenticateToken, companyController.getProfile);
router.delete('/clear', authenticateToken, companyController.clearCompanyData);
router.post('/close-year', authenticateToken, companyController.closeYear);

module.exports = router;