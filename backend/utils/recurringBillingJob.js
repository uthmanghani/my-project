const cron = require('node-cron');
const RecurringBilling = require('../models/RecurringBilling');
const AuditLog = require('../models/AuditLog');
const { runOne, advance } = require('../controllers/recurringBillingController')._internal;

// This is a SECOND, separate recurring mechanism from utils/recurringJob.js
// (which recurs a full Invoice template via Invoice.isRecurring). This one
// drives the standalone "Recurring Billing" page — simple named schedules
// that can generate either an invoice OR a bill for a flat amount. Before
// this file existed, that page only wrote to localStorage: nothing ran
// automatically, and "Run Now" was the only way a schedule ever fired,
// meaning bills in particular (which had no auto-generation path at all,
// even server-side) needed someone to remember to click a button on every
// due date.
function startRecurringBillingJob() {
  // Runs every day at 8:15am — a few minutes after the existing recurring
  // invoice job, so the two never contend for the same accounts/company
  // documents at the exact same moment.
  cron.schedule('15 8 * * *', async () => {
    const today = new Date();
    const due = await RecurringBilling.find({
      active: true,
      nextDate: { $lte: today },
      $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gte: today } }]
    });

    for (const rb of due) {
      // One schedule's failure (missing account, deleted customer/vendor,
      // whatever) must not block every other schedule due the same day.
      try {
        const { created, error } = await runOne(rb);
        if (error) throw new Error(error);

        rb.nextDate = advance(rb.nextDate, rb.frequency);
        rb.lastRunAt = today;
        await rb.save();

        await new AuditLog({
          companyId: rb.companyId,
          userId: null,
          userEmail: 'system:recurring-billing-job',
          action: 'RECURRING_BILLING_GENERATED',
          detail: `Generated ${rb.type} ${created.number || ''} from recurring schedule "${rb.name}" (NGN ${Number(rb.amount).toLocaleString()})`,
          ip: 'system-cron'
        }).save();
      } catch (err) {
        console.error(`Recurring billing generation failed for schedule "${rb.name}" (company ${rb.companyId}):`, err.message);
        try {
          await new AuditLog({
            companyId: rb.companyId,
            userId: null,
            userEmail: 'system:recurring-billing-job',
            action: 'RECURRING_BILLING_FAILED',
            detail: `Failed to generate ${rb.type} from recurring schedule "${rb.name}": ${err.message}`,
            ip: 'system-cron'
          }).save();
        } catch (logErr) {
          console.error('Additionally failed to write audit log for the above failure:', logErr.message);
        }
      }
    }
  });
}

module.exports = { startRecurringBillingJob };
