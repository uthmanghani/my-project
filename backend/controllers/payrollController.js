const Employee = require('../models/Employee');
const AppError = require('../utils/AppError');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');
const BankAccount = require('../models/BankAccount');
const BankTransaction = require('../models/BankTransaction');
const { calculatePAYE } = require('../utils/taxCalculations');
const mongoose = require('mongoose');

exports.recordSinglePayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { employeeId, date, monthlyGross, monthlyNet, monthlyPAYE, monthlyPension, bankCode } = req.body;
    // SECURITY: was Employee.findById with no companyId check â any user of
    // ANY company could run payroll against another company's employee,
    // posting the pay out of THEIR OWN cash and salary accounts.
    const employee = await Employee.findOne({ _id: employeeId, companyId: req.user.companyId }).session(session);
    if (!employee) throw new AppError('Employee not found', 404);

    const salaryAccount = await Account.findOne({ companyId: req.user.companyId, code: '6000' }).session(session);
    const cashAccount = await Account.findOne({ companyId: req.user.companyId, code: bankCode || '1000' }).session(session);
    let payeAccount = await Account.findOne({ companyId: req.user.companyId, code: '2200' }).session(session);
    if (!payeAccount) {
      payeAccount = new Account({
        companyId: req.user.companyId,
        code: '2200',
        name: 'PAYE Payable',
        type: 'Liability',
        balance: 0
      });
      await payeAccount.save({ session });
    }
    let pensionAccount = await Account.findOne({ companyId: req.user.companyId, code: '2300' }).session(session);
    if (!pensionAccount) {
      pensionAccount = new Account({
        companyId: req.user.companyId,
        code: '2300',
        name: 'Pension Payable',
        type: 'Liability',
        balance: 0
      });
      await pensionAccount.save({ session });
    }

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date,
      description: `Salary - ${employee.name}`,
      type: 'payroll',
      lines: [
        { accountCode: salaryAccount.code, amount: monthlyGross, type: 'debit' },
        { accountCode: cashAccount.code, amount: monthlyNet, type: 'credit' },
        { accountCode: payeAccount.code, amount: monthlyPAYE, type: 'credit' },
        { accountCode: pensionAccount.code, amount: monthlyPension, type: 'credit' }
      ]
    });
    await journal.save({ session });

    salaryAccount.balance += monthlyGross;
    cashAccount.balance -= monthlyNet;
    payeAccount.balance += monthlyPAYE;
    pensionAccount.balance += monthlyPension;
    await salaryAccount.save({ session });
    await cashAccount.save({ session });
    await payeAccount.save({ session });
    await pensionAccount.save({ session });

    // Without this, the ledger's Cash account correctly goes down by every
    // payroll run, but the Banking module (which computes a bank account's
    // balance from openingBalance + its own BankTransaction records, not
    // from the ledger) never reflects it -- payroll was the one money-out
    // path in this app that skipped this, so Banking silently overstated
    // cash by the running total of every payroll ever run.
    const bankAccountDoc = await BankAccount.findOne({ companyId: req.user.companyId, code: bankCode || '1000' }).session(session);
    if (bankAccountDoc) {
      const bankTx = new BankTransaction({
        companyId: req.user.companyId,
        bankId: bankAccountDoc._id,
        bankAccountCode: bankCode || '1000',
        date,
        type: 'debit',
        amount: monthlyNet,
        description: `Salary payment - ${employee.name}`,
        reference: null,
        reconciled: false
      });
      await bankTx.save({ session });
    }

    await session.commitTransaction();
    res.json({ message: 'Payroll recorded' });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    session.endSession();
  }
};

exports.runBatchPayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { month, year, bankCode } = req.body;
    const payDate = `${year}-${String(month).padStart(2, '0')}-28`;
    const employees = await Employee.find({ companyId: req.user.companyId }).session(session);
    if (!employees.length) throw new AppError('No employees found', 400);

    let totalGross = 0, totalPAYE = 0, totalPension = 0, totalNet = 0;
    for (const emp of employees) {
      const calc = calculatePAYE(emp.annualSalary, emp.annualRent || 0);
      totalGross += calc.monthlyGross;
      totalPAYE += calc.monthlyPAYE;
      totalPension += calc.monthlyPension;
      totalNet += calc.monthlyNet;
    }

    const salaryAccount = await Account.findOne({ companyId: req.user.companyId, code: '6000' }).session(session);
    const cashAccount = await Account.findOne({ companyId: req.user.companyId, code: bankCode || '1000' }).session(session);
    let payeAccount = await Account.findOne({ companyId: req.user.companyId, code: '2200' }).session(session);
    if (!payeAccount) {
      payeAccount = new Account({
        companyId: req.user.companyId,
        code: '2200',
        name: 'PAYE Payable',
        type: 'Liability',
        balance: 0
      });
      await payeAccount.save({ session });
    }
    let pensionAccount = await Account.findOne({ companyId: req.user.companyId, code: '2300' }).session(session);
    if (!pensionAccount) {
      pensionAccount = new Account({
        companyId: req.user.companyId,
        code: '2300',
        name: 'Pension Payable',
        type: 'Liability',
        balance: 0
      });
      await pensionAccount.save({ session });
    }

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date: payDate,
      description: `Payroll Run - ${month}/${year} (${employees.length} employees)`,
      type: 'payroll',
      lines: [
        { accountCode: salaryAccount.code, amount: totalGross, type: 'debit' },
        { accountCode: cashAccount.code, amount: totalNet, type: 'credit' },
        { accountCode: payeAccount.code, amount: totalPAYE, type: 'credit' },
        { accountCode: pensionAccount.code, amount: totalPension, type: 'credit' }
      ]
    });
    await journal.save({ session });

    salaryAccount.balance += totalGross;
    cashAccount.balance -= totalNet;
    payeAccount.balance += totalPAYE;
    pensionAccount.balance += totalPension;
    await salaryAccount.save({ session });
    await cashAccount.save({ session });
    await payeAccount.save({ session });
    await pensionAccount.save({ session });

    // Same fix as recordSinglePayroll -- see the comment there. One summary
    // transaction for the whole run, matching how the journal entry above
    // posts one summary line rather than one per employee.
    const bankAccountDoc = await BankAccount.findOne({ companyId: req.user.companyId, code: bankCode || '1000' }).session(session);
    if (bankAccountDoc) {
      const bankTx = new BankTransaction({
        companyId: req.user.companyId,
        bankId: bankAccountDoc._id,
        bankAccountCode: bankCode || '1000',
        date: payDate,
        type: 'debit',
        amount: totalNet,
        description: `Payroll run - ${month}/${year} (${employees.length} employees)`,
        reference: null,
        reconciled: false
      });
      await bankTx.save({ session });
    }

    await session.commitTransaction();
    res.json({ message: 'Batch payroll processed', totalGross, totalNet, totalPAYE, totalPension });
  } catch (err) {
    await session.abortTransaction();
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    session.endSession();
  }
};