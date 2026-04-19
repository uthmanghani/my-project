const cron = require('node-cron');
const Invoice = require('../models/Invoice');
const Company = require('../models/Company');
 
function startRecurringJob() {
  // Runs every day at 8am
  cron.schedule('0 8 * * *', async () => {
    const today = new Date();
    const due = await Invoice.find({
      isRecurring: true,
      recurringNextDate: { $lte: today },
      $or: [{ recurringEndDate: { $exists: false } }, { recurringEndDate: { $gte: today } }]
    });
    for (const inv of due) {
      const newInv = new Invoice({
        ...inv.toObject(),
        _id: undefined,
        number: inv.number + '-R',
        date: today.toISOString().split('T')[0],
        status: 'unpaid',
        amountPaid: 0,
        balance: inv.total,
        payments: [],
        isRecurring: false,
      });
      await newInv.save();
      // Update next date
      const next = new Date(inv.recurringNextDate);
      if (inv.recurringFrequency === 'weekly') next.setDate(next.getDate() + 7);
      else if (inv.recurringFrequency === 'monthly') next.setMonth(next.getMonth() + 1);
      else next.setMonth(next.getMonth() + 3);
      inv.recurringNextDate = next;
      await inv.save();
    }
  });
}
 
module.exports = { startRecurringJob };
