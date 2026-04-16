const mongoose = require('mongoose');

const EmployeeSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  name: String,
  employeeId: String,
  position: String,
  department: String,
  annualSalary: Number,
  annualRent: { type: Number, default: 0 },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Employee', EmployeeSchema);