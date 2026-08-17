const Employee = require('../models/Employee');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');
const { calculatePAYE, calculateLevies } = require('../utils/taxCalculations');
const mongoose = require('mongoose');
const { logAudit } = require('../utils/auditLog');

exports.getAll = async (req, res) => {
  try {
    const employees = await Employee.find({ companyId: req.user.companyId, isActive: { $ne: false } }).sort({ name: 1 });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const employee = new Employee({ ...req.body, companyId: req.user.companyId });
    await employee.save();
    res.status(201).json(employee);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const employee = await Employee.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json(employee);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const employee = await Employee.findOneAndUpdate(
      { companyId: req.user.companyId, _id: req.params.id },
      { isActive: false },
      { new: true }
    );
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    await logAudit(req, 'EMPLOYEE_DEACTIVATED', `Deactivated employee ${employee.firstName || ''} ${employee.lastName || ''}`.trim());
    res.json({ message: 'Employee deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.runPayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { month, year } = req.body;
    const payDate = `${year}-${String(month).padStart(2, '0')}-28`;
    const employees = await Employee.find({ companyId: req.user.companyId }).session(session);
    if (!employees.length) throw new Error('No employees found');

    let totalGross = 0, totalPAYE = 0, totalPension = 0, totalNet = 0, totalNHF = 0;
    let totalNSITF = 0, totalITF = 0;
    for (const emp of employees) {
      const calc = calculatePAYE(emp.annualSalary, emp.annualRent || 0);
      const levies = calculateLevies(calc.monthlyGross, calc.monthlyGross * 0.7);
      totalGross += calc.monthlyGross;
      totalPAYE += calc.monthlyPAYE;
      totalPension += calc.monthlyPension;
      totalNHF += calc.monthlyNHF;
      totalNet += calc.monthlyNet;
      totalNSITF += levies.nsitf;
      totalITF += levies.itf;
    }

    const salaryAccount = await Account.findOne({ companyId: req.user.companyId, code: '6000' }).session(session);
    const cashAccount = await Account.findOne({ companyId: req.user.companyId, code: '1000' }).session(session);
    let payeAccount = await Account.findOne({ companyId: req.user.companyId, code: '2200' }).session(session);
    if (!payeAccount) {
      payeAccount = new Account({ companyId: req.user.companyId, code: '2200', name: 'PAYE Payable', type: 'Liability', balance: 0 });
      await payeAccount.save({ session });
    }
    let pensionAccount = await Account.findOne({ companyId: req.user.companyId, code: '2300' }).session(session);
    if (!pensionAccount) {
      pensionAccount = new Account({ companyId: req.user.companyId, code: '2300', name: 'Pension Payable', type: 'Liability', balance: 0 });
      await pensionAccount.save({ session });
    }
    // NHF is an employee deduction — was calculated but never actually
    // withheld or tracked as a liability before this fix, meaning it was
    // effectively being paid out to employees instead of remitted.
    let nhfAccount = await Account.findOne({ companyId: req.user.companyId, code: '2350' }).session(session);
    if (!nhfAccount) {
      nhfAccount = new Account({ companyId: req.user.companyId, code: '2350', name: 'NHF Payable', type: 'Liability', balance: 0 });
      await nhfAccount.save({ session });
    }
    // NSITF/ITF are employer-paid costs — separate from salary expense
    // and don't touch net pay, but still need to hit the books.
    let statutoryExpenseAccount = await Account.findOne({ companyId: req.user.companyId, code: '6350' }).session(session);
    if (!statutoryExpenseAccount) {
      statutoryExpenseAccount = new Account({ companyId: req.user.companyId, code: '6350', name: 'Statutory Payroll Levies (NSITF/ITF)', type: 'Expense', balance: 0 });
      await statutoryExpenseAccount.save({ session });
    }
    let statutoryPayableAccount = await Account.findOne({ companyId: req.user.companyId, code: '2360' }).session(session);
    if (!statutoryPayableAccount) {
      statutoryPayableAccount = new Account({ companyId: req.user.companyId, code: '2360', name: 'Statutory Levies Payable (NSITF/ITF)', type: 'Liability', balance: 0 });
      await statutoryPayableAccount.save({ session });
    }

    const totalEmployerLevies = totalNSITF + totalITF;

    const journalLines = [
      { accountCode: salaryAccount.code, amount: totalGross, type: 'debit' },
      { accountCode: cashAccount.code, amount: totalNet, type: 'credit' },
      { accountCode: payeAccount.code, amount: totalPAYE, type: 'credit' },
      { accountCode: pensionAccount.code, amount: totalPension, type: 'credit' },
      { accountCode: nhfAccount.code, amount: totalNHF, type: 'credit' }
    ];
    if (totalEmployerLevies > 0) {
      journalLines.push({ accountCode: statutoryExpenseAccount.code, amount: totalEmployerLevies, type: 'debit' });
      journalLines.push({ accountCode: statutoryPayableAccount.code, amount: totalEmployerLevies, type: 'credit' });
    }

    const journal = new JournalEntry({
      companyId: req.user.companyId,
      date: payDate,
      description: `Payroll Run - ${month}/${year} (${employees.length} employees)`,
      type: 'payroll',
      lines: journalLines
    });
    await journal.save({ session });

    salaryAccount.balance += totalGross;
    cashAccount.balance -= totalNet;
    payeAccount.balance += totalPAYE;
    pensionAccount.balance += totalPension;
    nhfAccount.balance += totalNHF;
    await salaryAccount.save({ session });
    await cashAccount.save({ session });
    await payeAccount.save({ session });
    await pensionAccount.save({ session });
    await nhfAccount.save({ session });
    if (totalEmployerLevies > 0) {
      statutoryExpenseAccount.balance += totalEmployerLevies;
      statutoryPayableAccount.balance += totalEmployerLevies;
      await statutoryExpenseAccount.save({ session });
      await statutoryPayableAccount.save({ session });
    }

    await logAudit(req, 'PAYROLL_RUN', `Payroll run for ${month}/${year} — ${employees.length} employees, gross ₦${totalGross.toLocaleString()}, net ₦${totalNet.toLocaleString()}`, session);

    await session.commitTransaction();
    res.json({ message: 'Batch payroll processed', totalGross, totalNet, totalPAYE, totalPension, totalNHF, totalEmployerLevies });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};