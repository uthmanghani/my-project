const express = require('express');
const router = express.Router();
const inviteController = require('../controllers/inviteController');
 
// Super admin middleware — checks SUPER_ADMIN_KEY header
function requireSuperAdmin(req, res, next) {
  const key = req.headers['x-super-admin-key'] || req.query.key;
  if (key !== process.env.SUPER_ADMIN_KEY) {
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