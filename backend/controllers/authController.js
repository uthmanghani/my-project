const User = require('../models/User');
const Company = require('../models/Company');
const Account = require('../models/Account');
const INDUSTRIES = require('../utils/industryData');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const crypto = require('crypto');

exports.register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { company, industry, admin } = req.body;

  try {
    const existingCompany = await Company.findOne({ email: company.email });
    if (existingCompany) {
      return res.status(400).json({ error: 'A company with this email already exists' });
    }

    const existingUser = await User.findOne({ email: admin.email });
    if (existingUser) {
      return res.status(400).json({ error: 'Admin email already registered' });
    }

    const newCompany = new Company({
      name: company.companyName,
      rcNumber: company.rc,
      tin: company.tin,
      phone: company.phone,
      email: company.email,
      address: company.address,
      industry: industry
    });
    await newCompany.save();

    const newUser = new User({
      companyId: newCompany._id,
      firstName: admin.firstName,
      lastName: admin.lastName,
      email: admin.email,
      password: admin.password,
      role: 'admin'
    });
    await newUser.save();

    const industryObj = INDUSTRIES.find(i => i.id === industry);
    if (!industryObj) {
      throw new Error('Invalid industry selected');
    }

    if (industryObj.accounts && industryObj.accounts.length) {
      const accounts = industryObj.accounts.map(acc => ({
        companyId: newCompany._id,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        balance: 0,
        openingBalance: 0
      }));
      await Account.insertMany(accounts);
    }

    const token = jwt.sign(
      { userId: newUser._id, companyId: newCompany._id, email: newUser.email, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    res.status(201).json({
      token,
      user: {
        id: newUser._id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { userId: user._id, companyId: user.companyId, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );
    res.json({
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.inviteUser = async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;
    if (!['admin', 'accountant', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Use admin, accountant or viewer.' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    const newUser = new User({
      companyId: req.user.companyId,
      firstName,
      lastName,
      email,
      password,
      role
    });
    await newUser.save();
    res.status(201).json({
      message: 'User invited successfully',
      user: { id: newUser._id, firstName, lastName, email, role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ companyId: req.user.companyId }).select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'No account found with that email' });
    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();
    const { sendPasswordResetEmail } = require('../utils/emailService');
    await sendPasswordResetEmail({ to: email, token, firstName: user.firstName });
    res.json({ message: 'Password reset email sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
 
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
 
exports.removeUser = async (req, res) => {

  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can remove users' });
    }
    const user = await User.findOneAndDelete({ companyId: req.user.companyId, _id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};