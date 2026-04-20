const Invite = require('../models/Invite');
const crypto = require('crypto');
 
// Generate a new invite token (super admin only)
exports.generateInvite = async (req, res) => {
  try {
    const { email, note } = req.body;
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
    const invite = new Invite({ token, email: email || null, note: note || '', expiresAt });
    await invite.save();
    const link = `${process.env.FRONTEND_URL}?invite=${token}`;
    res.status(201).json({ token, link, expiresAt, message: 'Invite created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
 
// Validate an invite token (called before registration)
exports.validateInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const invite = await Invite.findOne({ token });
    if (!invite) return res.status(404).json({ valid: false, error: 'Invalid invite link' });
    if (invite.used) return res.status(400).json({ valid: false, error: 'This invite has already been used' });
    if (invite.expiresAt < new Date()) return res.status(400).json({ valid: false, error: 'This invite link has expired' });
    res.json({ valid: true, email: invite.email, note: invite.note, expiresAt: invite.expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
 
// Consume an invite token (called after successful registration)
exports.consumeInvite = async (req, res) => {
  try {
    const { token, companyEmail } = req.body;
    const invite = await Invite.findOne({ token });
    if (!invite || invite.used || invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired invite' });
    }
    invite.used = true;
    invite.usedAt = new Date();
    invite.usedBy = companyEmail || 'unknown';
    await invite.save();
    res.json({ message: 'Invite consumed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
 
// List all invites (super admin only)
exports.listInvites = async (req, res) => {
  try {
    const invites = await Invite.find().sort({ createdAt: -1 }).limit(100);
    res.json(invites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
 
// Revoke an invite (super admin only)
exports.revokeInvite = async (req, res) => {
  try {
    await Invite.findByIdAndDelete(req.params.id);
    res.json({ message: 'Invite revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};