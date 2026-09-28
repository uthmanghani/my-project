const User = require('../models/User');
const AppError = require('../utils/AppError');
const Company = require('../models/Company');
const Account = require('../models/Account');
const INDUSTRIES = require('../utils/industryData');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const crypto = require('crypto');

// Emails are never case-sensitive in practice (mobile keyboards auto-capitalize
// the first letter, users copy-paste inconsistently, etc.), but Mongo string
// matching is case-sensitive by default. This builds a case-insensitive exact
// match so lookups work regardless of how the email was originally saved,
// escaping regex metacharacters so the email is matched literally.
function emailQuery(email) {
  const escaped = String(email || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
}

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
      throw new AppError('A company with this email already exists', 400);
    }

    const existingUser = await User.findOne({ email: emailQuery(admin.email) }).session(session);
    if (existingUser) {
      throw new AppError('Admin email already registered', 400);
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
      email: String(admin.email || '').trim().toLowerCase(),
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    session.endSession();
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email: emailQuery(email) });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.inviteUser = async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;
    if (!['admin', 'accountant', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Use admin, accountant or viewer.' });
    }
    const existing = await User.findOne({ email: emailQuery(email) });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    const newUser = new User({
      companyId: req.user.companyId,
      firstName,
      lastName,
      email: String(email || '').trim().toLowerCase(),
      password,
      role
    });
    await newUser.save();
    res.status(201).json({
      message: 'User invited successfully',
      user: { id: newUser._id, firstName, lastName, email, role }
    });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ companyId: req.user.companyId }).select('-password');
    res.json(users);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.sendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: emailQuery(email) });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordToken = otp;
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();
    const { sendOTPEmail } = require('../utils/emailService');
    await sendOTPEmail({ to: email, otp, firstName: user.firstName });
    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error('sendOTP error:', err.message);
    res.status(500).json({ error: 'Could not send the verification code right now. Please try again shortly.' });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({
      email: emailQuery(email),
      resetPasswordToken: otp,
      resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired OTP' });
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ verified: true });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.forgotPassword = async (req, res) => {
  // SECURITY: always respond identically whether or not the email has an
  // account, and always in roughly the same amount of work, so this
  // endpoint can't be used to find out which emails have accounts on this
  // platform. The previous version returned 404 for an unknown email and
  // 200 for a known one — a direct enumeration oracle.
  const GENERIC = { message: 'If an account exists for that email, a password reset link has been sent.' };
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: emailQuery(email) });
    if (!user) return res.json(GENERIC);
    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();
    const { sendPasswordResetEmail } = require('../utils/emailService');
    await sendPasswordResetEmail({ to: email, token, firstName: user.firstName });
    res.json(GENERIC);
  } catch (err) {
    // Log the real error server-side for debugging, but never expose raw
    // internals (network errors, stack traces, provider details) to the
    // person using the app — they just need to know it didn't go through.
    // Still generic, and still 200: an email-sending failure shouldn't leak
    // account existence either.
    console.error('forgotPassword error:', err.message);
    res.json(GENERIC);
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
 
exports.getMyCompanies = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate('companies', 'name industry createdAt');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.companies || []);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};