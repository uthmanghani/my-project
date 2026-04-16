const AuditLog = require('../models/AuditLog');

exports.getAll = async (req, res) => {
  try {
    const logs = await AuditLog.find({ companyId: req.user.companyId }).sort({ createdAt: -1 }).limit(1000);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.logAction = async (req, res) => {
  try {
    const { action, detail } = req.body;
    const log = new AuditLog({
      companyId: req.user.companyId,
      userId: req.user.userId,
      userEmail: req.user.email,
      action,
      detail,
      ip: req.ip
    });
    await log.save();
    res.status(201).json({ message: 'Logged' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.clear = async (req, res) => {
  try {
    await AuditLog.deleteMany({ companyId: req.user.companyId });
    res.json({ message: 'Audit log cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};