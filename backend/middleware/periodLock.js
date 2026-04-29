const Company = require('../models/Company');

exports.checkPeriodLock = async (req, res, next) => {
  try {
    const company = await Company.findById(req.user.companyId);
    if (!company) return next();
    const lockedUntil = company.lockedUntilDate;
    if (!lockedUntil) return next();

    const txDate = req.body.date ? new Date(req.body.date) : null;
    if (txDate && txDate <= lockedUntil) {
      return res.status(403).json({
        error: `Transactions are locked for dates on or before ${lockedUntil.toISOString().split('T')[0]}. Please contact your administrator.`
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};