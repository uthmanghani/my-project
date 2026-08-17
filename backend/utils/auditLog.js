const AuditLog = require('../models/AuditLog');

/**
 * Write an audit log entry. Never throws — a failed audit write must not
 * block or roll back the actual operation it's describing, but it's always
 * logged to the console so a silent audit failure is at least visible in
 * server logs.
 *
 * @param {object} req - the Express request (needs req.user, req.ip)
 * @param {string} action - short machine-readable action code, e.g. 'JOURNAL_VOIDED'
 * @param {string} detail - human-readable description of what happened
 * @param {import('mongoose').ClientSession} [session] - pass the active
 *   transaction session so the log entry commits/rolls back with everything
 *   else in the same operation, if the caller is inside a transaction.
 */
async function logAudit(req, action, detail, session) {
  try {
    const entry = new AuditLog({
      companyId: req.user.companyId,
      userId: req.user.userId,
      userEmail: req.user.email,
      action,
      detail,
      ip: req.ip || req.headers['x-forwarded-for'] || ''
    });
    await entry.save(session ? { session } : undefined);
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { logAudit };
