const User = require('../models/User');
const Company = require('../models/Company');
const Account = require('../models/Account');
const INDUSTRIES = require('../utils/industryData');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

exports.register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { company, industry, admin } = req.body;

  try {
    // Check if company email already exists
    const existingCompany = await Company.findOne({ email: company.email });
    if (existingCompany) {
      return res.status(400).json({ error: 'A company with this email already exists' });
    }

    // Check if admin email already exists
    const existingUser = await User.findOne({ email: admin.email });
    if (existingUser) {
      return res.status(400).json({ error: 'Admin email already registered' });
    }

    // Create company
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

    // Create admin user
    const newUser = new User({
      companyId: newCompany._id,
      firstName: admin.firstName,
      lastName: admin.lastName,
      email: admin.email,
      password: admin.password,
      role: 'admin'
    });
    await newUser.save();

    // Seed chart of accounts from industry template
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

exports.inviteUser = async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;
    if (!['admin','accountant','viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Use admin, accountant or viewer.' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    const newUser = new User({
      companyId: req.user.companyId,
      firstName, lastName, email, password, role
    });
    await newUser.save();
    res.status(201).json({ message: 'User invited successfully', user: { id: newUser._id, firstName, lastName, email, role } });
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

exports.removeUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can remove users' });
    const user = await User.findOneAndDelete({ companyId: req.user.companyId, _id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User removed' });
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
 
exports.removeUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can remove users' });
    const user = await User.findOneAndDelete({ companyId: req.user.companyId, _id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User removed' });
  } catch (err) {
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