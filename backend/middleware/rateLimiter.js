const rateLimit = require('express-rate-limit');

/**
 * General rate limiter for all API endpoints
 * Prevents abuse and brute-force attacks
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

/**
 * Stricter limiter for authentication endpoints (login/register)
 * Prevents brute-force password attacks
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 10 authentication attempts per 15 minutes
  skipSuccessfulRequests: true, // Don't count successful logins towards the limit
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Very strict limiter for sensitive operations (e.g., data deletion)
 */
const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 5 attempts per hour
  message: { error: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generalLimiter, authLimiter, strictLimiter };