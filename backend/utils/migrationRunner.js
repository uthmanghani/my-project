const fs = require('fs');
const path = require('path');
const Migration = require('../models/Migration');

/**
 * Runs every migration in /migrations that hasn't already been recorded as
 * applied, in filename order (hence the numeric prefixes like '001-', '002-').
 *
 * Call this once, right after the database connects, on every server boot.
 * It's safe to leave permanently — already-applied migrations are skipped
 * via the Migration collection, so nothing ever re-runs.
 *
 * A migration file must export { name, up }, where 'up' is an async
 * function that performs the actual change and receives no arguments
 * (it can require whatever models/mongoose it needs itself).
 *
 * A failed migration is logged clearly but does NOT crash the server —
 * one broken migration shouldn't take the whole app down, since most of
 * the app likely still works fine without it. Fix the migration and
 * redeploy; it'll be retried on the next boot since it was never recorded
 * as applied.
 */
async function runMigrations() {
  const dir = path.join(__dirname, '../migrations');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .sort(); // relies on numeric filename prefixes for ordering

  if (!files.length) return;

  console.log(`🔧 Checking ${files.length} migration(s)...`);

  for (const file of files) {
    let migration;
    try {
      migration = require(path.join(dir, file));
    } catch (err) {
      console.error(`❌ Could not load migration file ${file}:`, err.message);
      continue;
    }
    if (!migration.name || typeof migration.up !== 'function') {
      console.error(`❌ Migration file ${file} is missing a 'name' or 'up' export — skipping.`);
      continue;
    }

    const alreadyApplied = await Migration.findOne({ name: migration.name });
    if (alreadyApplied) continue; // silent — this is the normal case on every boot after the first

    console.log(`  → Applying migration: ${migration.name}`);
    try {
      await migration.up();
      await new Migration({ name: migration.name }).save();
      console.log(`  ✅ Applied: ${migration.name}`);
    } catch (err) {
      console.error(`  ❌ Migration '${migration.name}' failed and was NOT recorded as applied — it will retry on next boot:`, err.message);
    }
  }
}

module.exports = { runMigrations };
