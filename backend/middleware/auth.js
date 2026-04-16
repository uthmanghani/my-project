const jwt = require('jsonwebtoken');

/**
 * Authentication middleware
 * Verifies JWT token from Authorization header
 * Attaches user object to req.user
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // contains { userId, companyId, email, role, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please login again.' });
    }
    return res.status(403).json({ error: 'Invalid token.' });
  }
};

/**
 * Role-based authorization middleware
 * @param {...string} allowedRoles - List of roles allowed to access the route
 * @returns {Function} Express middleware
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
};

/**
 * Permission-based authorization (more granular)
 * @param {string} permission - Required permission
 * @returns {Function} Express middleware
 */
const hasPermission = (permission) => {
  // Define permission sets per role
  const permissions = {
    admin: ['*'], // wildcard – all permissions
    accountant: ['view_invoices', 'create_invoices', 'edit_invoices', 'record_payments', 'view_reports', 'view_customers', 'view_vendors', 'create_customers', 'edit_customers'],
    viewer: ['view_invoices', 'view_reports', 'view_customers', 'view_vendors', 'view_products']
  };
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const userPerms = permissions[req.user.role] || [];
    if (userPerms.includes('*') || userPerms.includes(permission)) {
      next();
    } else {
      res.status(403).json({ error: `Permission denied: ${permission}` });
    }
  };
};

module.exports = { authenticateToken, authorizeRoles, hasPermission };