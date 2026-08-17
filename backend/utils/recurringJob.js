const cron = require('node-cron');
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const AuditLog = require('../models/AuditLog');
const { createAndPostInvoice } = require('./invoicePosting');

function startRecurringJob() {
  // Runs every day at 8am
  cron.schedule('0 8 * * *', async () => {
    const today = new Date();
    const due = await Invoice.find({
      isRecurring: true,
      recurringNextDate: { $lte: today },
      $or: [{ recurringEndDate: { $exists: false } }, { recurringEndDate: null }, { recurringEndDate: { $gte: today } }]
    });

    for (const inv of due) {
      // Each invoice gets its own transaction and its own try/catch — one
      // failure (bad data, missing account, whatever) must not silently
      // block every other recurring invoice due that day, and must not
      // leave recurringNextDate stuck in the past retrying forever.
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        // Post a real invoice through the same accounting logic as the API
        // endpoint — proper sequential numbering (was previously always
        // "<original number>-R", which collided with the unique index on
        // every recurrence after the first and silently broke recurring
        // invoicing entirely), a full AR/Revenue/VAT journal entry, and
        // COGS/stock updates. The old version bypassed all of this and
        // just wrote a bare Invoice document with zero ledger impact.
        const newInvoiceData = {
          customerId: inv.customerId,
          currency: inv.currency,
          exchangeRate: inv.exchangeRate,
          date: today.toISOString().split('T')[0],
          dueDate: inv.dueDate,
          lines: inv.lines,
          subtotal: inv.subtotal,
          vat: inv.vat,
          total: inv.total,
          notes: inv.notes,
          isRecurring: false
        };
        const newInv = await createAndPostInvoice({
          companyId: inv.companyId,
          data: newInvoiceData,
          session
        });

        // Advance to the next occurrence. Field name was previously
        // 'recurringFrequency', which doesn't exist on this schema
        // (that field was consolidated into 'recurringFreq') — meant
        // every recurrence silently fell through to the quarterly branch
        // regardless of what frequency was actually selected.
        const next = new Date(inv.recurringNextDate);
        if (inv.recurringFreq === 'weekly') next.setDate(next.getDate() + 7);
        else if (inv.recurringFreq === 'monthly') next.setMonth(next.getMonth() + 1);
        else if (inv.recurringFreq === 'annually') next.setFullYear(next.getFullYear() + 1);
        else next.setMonth(next.getMonth() + 3); // quarterly, and any unrecognized value
        inv.recurringNextDate = next;
        await inv.save({ session });

        await new AuditLog({
          companyId: inv.companyId,
          userId: null,
          userEmail: 'system:recurring-job',
          action: 'RECURRING_INVOICE_GENERATED',
          detail: `Generated Invoice ${newInv.number} from recurring template ${inv.number} (NGN ${newInv.total.toLocaleString()})`,
          ip: 'system-cron'
        }).save({ session });

        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        console.error(`Recurring invoice generation failed for template ${inv.number} (company ${inv.companyId}):`, err.message);
        try {
          await new AuditLog({
            companyId: inv.companyId,
            userId: null,
            userEmail: 'system:recurring-job',
            action: 'RECURRING_INVOICE_FAILED',
            detail: `Failed to generate invoice from recurring template ${inv.number}: ${err.message}`,
            ip: 'system-cron'
          }).save();
        } catch (logErr) {
          console.error('Additionally failed to write audit log for the above failure:', logErr.message);
        }
      } finally {
        session.endSession();
      }
    }
  });
}

module.exports = { startRecurringJob };
