const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const authController = require('../controllers/authController');

// Public routes
router.post('/register', [
  body('company.companyName').notEmpty().withMessage('Company name required'),
  body('admin.email').isEmail().withMessage('Valid email required'),
  body('admin.password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
], authController.register);

router.post('/login', [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
], authController.login);

// Protected routes (require authentication)
router.post('/invite', authenticateToken, authController.inviteUser);
router.get('/users', authenticateToken, authController.getUsers);
router.delete('/users/:id', authenticateToken, authController.removeUser);

router.post('/send-otp', authController.sendOTP);
router.post('/verify-otp', authController.verifyOTP);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
 
module.exports = router;
