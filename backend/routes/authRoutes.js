const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');

router.post('/register', [
  body('company.companyName').notEmpty().withMessage('Company name required'),
  body('admin.email').isEmail().withMessage('Valid email required'),
  body('admin.password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
], authController.register);

router.post('/login', [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
], authController.login);

module.exports = router;