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

  // Validate the industry BEFORE writing anything. Previously this check ran
  // after the Company and User were already saved, so an unrecognized industry
  // id left an orphaned company+user in the database with no chart of accounts.
  const industryObj = INDUSTRIES.find(i => i.id === industry) || INDUSTRIES.find(i => i.id === 'generic');
  if (!industryObj) {
    // Only reachable if 'generic' itself is ever removed from industryData.js.
    return res.status(400).json({ error: 'Invalid industry selected and no fallback industry is configured.' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const existingCompany = await Company.findOne({ email: company.email }).session(session);
    if (existingCompany) {
      throw Object.assign(new Error('A company with this email already exists'), { status: 400 });
    }

    const existingUser = await User.findOne({ email: admin.email }).session(session);
    if (existingUser) {
      throw Object.assign(new Error('Admin email already registered'), { status: 400 });
    }

    const newCompany = new Company({
      name: company.companyName,
      rcNumber: company.rc,
      tin: company.tin,
      phone: company.phone,
      email: company.email,
      address: company.address,
      // Store the resolved id, so a request with an unknown/legacy id still
      // lands on 'generic' instead of silently keeping an invalid value.
      industry: industryObj.id
    });
    await newCompany.save({ session });

    const newUser = new User({
      companyId: newCompany._id,
      firstName: admin.firstName,
      lastName: admin.lastName,
      email: admin.email,
      password: admin.password,
      role: 'admin',
      companies: [newCompany._id]
    });
    await newUser.save({ session });

    if (industryObj.accounts && industryObj.accounts.length) {
      const accounts = industryObj.accounts.map(acc => ({
        companyId: newCompany._id,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        balance: 0,
        openingBalance: 0
      }));
      await Account.insertMany(accounts, { session });
    }

    await session.commitTransaction();

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
    await session.abortTransaction();
    console.error('Registration error:', err);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    session.endSession();
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

exports.sendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordToken = otp;
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();
    const { sendOTPEmail } = require('../utils/emailService');
    await sendOTPEmail({ to: email, otp, firstName: user.firstName });
    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({
      email,
      resetPasswordToken: otp,
      resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired OTP' });
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ verified: true });
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
 
exports.getMyCompanies = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate('companies', 'name industry createdAt');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.companies || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.switchCompany = async (req, res) => {
  try {
    const { companyId } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const hasAccess = user.companies.some(c => c.toString() === companyId) ||
                      user.companyId.toString() === companyId;
    if (!hasAccess) return res.status(403).json({ error: 'No access to this company' });
    const token = jwt.sign(
      { userId: user._id, companyId, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );
    res.json({ token, companyId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addUserToCompany = async (req, res) => {
  try {
    const { userId } = req.body;
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.companies.includes(req.user.companyId)) {
      user.companies.push(req.user.companyId);
      await user.save();
    }
    res.json({ message: 'User added to company' });
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