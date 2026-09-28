const { validationResult } = require('express-validator');

// Runs after any array of express-validator body()/param() checks. Put this
// as the last item in the route's middleware array. On failure, responds
// with the first message (for callers reading req.body.error, same shape
// every other error in this app already uses) plus the full list.
module.exports = function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: errors.array()[0].msg,
      errors: errors.array()
    });
  }
  next();
};
