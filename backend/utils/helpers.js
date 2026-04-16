/**
 * Generate a numeric ID based on timestamp + random suffix
 * @returns {number} Unique numeric ID
 */
function genId() {
  return Date.now() + Math.floor(Math.random() * 9999);
}

/**
 * Get today's date in YYYY-MM-DD format
 * @returns {string} Today's date
 */
function today() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get a future date by adding days to today
 * @param {number} days - Number of days to add
 * @returns {string} Future date in YYYY-MM-DD
 */
function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Format a number as currency (default ₦)
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency symbol (default '₦')
 * @returns {string} Formatted currency
 */
function formatMoney(amount, currency = '₦') {
  return currency + Number(amount || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Get status badge class based on status string
 * @param {string} status - Status (paid, unpaid, overdue, partial, etc.)
 * @returns {string} CSS class name
 */
function getStatusBadgeClass(status) {
  const map = {
    paid: 'badge-success',
    unpaid: 'badge-warning',
    overdue: 'badge-danger',
    partial: 'badge-info',
    active: 'badge-success',
    inactive: 'badge-neutral',
    draft: 'badge-neutral'
  };
  return map[status] || 'badge-neutral';
}

/**
 * Check if a string is a valid email
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Check if a string is a valid Nigerian phone number (simple check)
 * @param {string} phone - Phone number
 * @returns {boolean} True if valid
 */
function isValidPhone(phone) {
  const re = /^(\+234|0)[7-9][0-1][0-9]{8}$/;
  return re.test(phone);
}

/**
 * Generate a random alphanumeric string (for temporary tokens, etc.)
 * @param {number} length - Desired length
 * @returns {string} Random string
 */
function randomString(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Deep clone an object
 * @param {object} obj - Object to clone
 * @returns {object} Cloned object
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Add months to a date and return YYYY-MM-DD
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {number} months - Number of months to add
 * @returns {string} New date
 */
function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

/**
 * Add days to a date and return YYYY-MM-DD
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {number} days - Number of days to add
 * @returns {string} New date
 */
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Calculate days between two dates
 * @param {string} date1 - First date YYYY-MM-DD
 * @param {string} date2 - Second date YYYY-MM-DD
 * @returns {number} Difference in days
 */
function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2 - d1);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

module.exports = {
  genId,
  today,
  futureDate,
  formatMoney,
  getStatusBadgeClass,
  isValidEmail,
  isValidPhone,
  randomString,
  deepClone,
  addMonths,
  addDays,
  daysBetween
};