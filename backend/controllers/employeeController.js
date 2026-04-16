const Employee = require('../models/Employee');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');
const { calculatePAYE } = require('../utils/taxCalculations');
const mongoose = require('mongoose');

exports.getAll = async (req, res) => {
  try {
    const employees = await Employee.find({ companyId: req.user.companyId }).sort({ name: 1 });
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
    const employee = await Employee.findOneAndDelete({
      companyId: req.user.companyId,
      _id: req.params.id
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json({ message: 'Employee deleted' });
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

    let totalGross = 0, totalPAYE = 0, totalPension = 0, totalNet = 0;
    for (const emp of employees) {
      const calc = calculatePAYE(emp.annualSalary, emp.annualRent || 0);
      totalGross += calc.monthlyGross;
      totalPAYE += calc.monthlyPAYE;
      totalPension += calc.monthlyPension;
      totalNet += calc.monthlyNet;
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

    await session.commitTransaction();
    res.json({ message: 'Batch payroll processed', totalGross, totalNet, totalPAYE, totalPension });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
};