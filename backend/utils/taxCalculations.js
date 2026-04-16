/**
 * Calculate PAYE (Personal Income Tax) under NTA 2025
 * Uses the progressive tax bands for Nigeria
 * 
 * @param {number} annualGross - Annual gross salary in NGN
 * @param {number} annualRent - Annual rent paid (for rent relief, max relief ₦500,000)
 * @returns {object} Detailed tax breakdown
 */
function calculatePAYE(annualGross, annualRent = 0) {
  // Pension deduction: 8% of annual gross
  const pension = annualGross * 0.08;
  
  // Rent relief: 20% of rent paid, capped at ₦500,000
  const rentRelief = Math.min(annualRent * 0.2, 500000);
  
  // Taxable income after deductions
  const taxableIncome = Math.max(0, annualGross - pension - rentRelief);
  
  // Progressive tax bands (NTA 2025)
  const bands = [
    { limit: 800000, rate: 0 },      // First ₦800,000 – 0%
    { limit: 3000000, rate: 0.15 },  // Next ₦2,200,000 – 15%
    { limit: 12000000, rate: 0.18 }, // Next ₦9,000,000 – 18%
    { limit: 25000000, rate: 0.21 }, // Next ₦13,000,000 – 21%
    { limit: 50000000, rate: 0.23 }, // Next ₦25,000,000 – 23%
    { limit: Infinity, rate: 0.25 }  // Above ₦50,000,000 – 25%
  ];
  
  let tax = 0;
  let remaining = taxableIncome;
  let prevLimit = 0;
  
  for (const band of bands) {
    const bandWidth = band.limit - prevLimit;
    const amountInBand = Math.min(remaining, bandWidth);
    tax += amountInBand * band.rate;
    remaining -= amountInBand;
    if (remaining <= 0) break;
    prevLimit = band.limit;
  }
  
  const annualPAYE = tax;
  const monthlyPAYE = tax / 12;
  const monthlyGross = annualGross / 12;
  const monthlyPension = pension / 12;
  const monthlyRentRelief = rentRelief / 12;
  const monthlyTaxable = taxableIncome / 12;
  const monthlyNet = monthlyGross - monthlyPension - monthlyPAYE;
  
  return {
    annualGross,
    pension,
    rentRelief,
    taxableIncome,
    annualPAYE,
    monthlyPAYE,
    monthlyGross,
    monthlyPension,
    monthlyRentRelief,
    monthlyTaxable,
    monthlyNet
  };
}

/**
 * Calculate VAT (Value Added Tax) on a given amount
 * 
 * @param {number} amount - Net amount before VAT
 * @param {number} rate - VAT rate as percentage (default 7.5)
 * @returns {number} VAT amount
 */
function calculateVAT(amount, rate = 7.5) {
  return (amount * rate) / 100;
}

/**
 * Calculate WHT (Withholding Tax) on a given amount
 * 
 * @param {number} amount - Gross amount subject to WHT
 * @param {number} rate - WHT rate as percentage (e.g., 5, 10)
 * @returns {number} WHT amount
 */
function calculateWHT(amount, rate) {
  return (amount * rate) / 100;
}

/**
 * Format a number as Nigerian Naira (₦)
 * 
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
function formatNaira(amount) {
  return '₦' + amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = {
  calculatePAYE,
  calculateVAT,
  calculateWHT,
  formatNaira
};