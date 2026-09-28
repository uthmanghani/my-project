const express = require('express');
const router = express.Router();
const inviteController = require('../controllers/inviteController');
 
const crypto = require('crypto');

// SECURITY: this used to be `key !== process.env.SUPER_ADMIN_KEY`. If the
// env var was ever unset (a forgotten deployment setting, not a hypothetical
// -- this app's own .env.example / Render config could easily omit it),
// then `key` (undefined, when no header/query param was sent at all) and
// `process.env.SUPER_ADMIN_KEY` (also undefined) compared EQUAL, so the
// check that's supposed to guard "who can invite new companies onto this
// platform" and "who can list every pending invite's email address" was
// satisfied by sending nothing at all. Now: no configured key, or no
// supplied key, is an immediate reject -- never a fall-through comparison
// that could accidentally match. The comparison itself is now
// constant-time (crypto.timingSafeEqual) rather than a plain !==, since
// this guards a long-lived, high-value secret and a plain string compare
// leaks how many leading characters matched through response timing.
function requireSuperAdmin(req, res, next) {
  const configuredKey = process.env.SUPER_ADMIN_KEY;
  const suppliedKey = req.headers['x-super-admin-key'] || req.query.key;
  if (!configuredKey || typeof suppliedKey !== 'string' || suppliedKey.length === 0) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const a = Buffer.from(suppliedKey);
  const b = Buffer.from(configuredKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}
 
// Public — validate token before showing registration form
router.get('/validate/:token', inviteController.validateInvite);
 
// Public — consume token after successful registration
router.post('/consume', inviteController.consumeInvite);
 
// Super admin only — generate, list and revoke invites
router.post('/generate', requireSuperAdmin, inviteController.generateInvite);
router.get('/list', requireSuperAdmin, inviteController.listInvites);
router.delete('/:id', requireSuperAdmin, inviteController.revokeInvite);
 
module.exports = router;