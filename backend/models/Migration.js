const mongoose = require('mongoose');

// Tracks which migrations have already been applied to this database.
// Each migration file's 'name' gets recorded here the moment it succeeds,
// so the runner can safely skip it on every future server boot — this is
// what makes it safe to leave migration-running wired into normal startup
// permanently, rather than needing to remember to add/remove code each time.
const MigrationSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  appliedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Migration', MigrationSchema);
