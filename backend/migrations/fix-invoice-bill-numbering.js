/**
 * One-time migration: fixes the invoice/bill numbering collision bug.
 *
 * The old schema had a bare `unique: true` on `number`, which MongoDB
 * enforces as a GLOBAL constraint across every company in the database —
 * not scoped per tenant. Every company's numbering starts at INV-0001 by
 * default, so any two companies' first invoice was guaranteed to collide.
 *
 * Changing the Mongoose schema alone does NOT fix this — Mongoose adds
 * indexes that are in the schema, but never automatically drops indexes
 * that were removed from it. The old global-unique index physically exists
 * in your database right now and will keep blocking invoice/bill creation
 * until it's explicitly dropped and replaced with the correct compound
 * index (unique per companyId + number).
 *
 * Run this ONCE, after deploying the updated Invoice.js and Bill.js models,
 * from your backend project root:
 *
 *   node migrations/fix-invoice-bill-numbering.js
 *
 * It's safe to run more than once — dropping a non-existent index is a
 * no-op, and creating an index that already exists correctly is a no-op too.
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function fixIndex(collectionName, oldIndexName) {
  const collection = mongoose.connection.collection(collectionName);
  const existingIndexes = await collection.indexes();

  const badIndex = existingIndexes.find(ix => ix.name === oldIndexName);
  if (badIndex) {
    await collection.dropIndex(oldIndexName);
    console.log(`  ✅ Dropped stale global index '${oldIndexName}' on ${collectionName}`);
  } else {
    console.log(`  ℹ️  No stale '${oldIndexName}' index found on ${collectionName} — already clean.`);
  }

  await collection.createIndex({ companyId: 1, number: 1 }, { unique: true, name: 'companyId_1_number_1' });
  console.log(`  ✅ Ensured correct compound index (companyId + number) on ${collectionName}`);
}

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  console.log('Fixing invoices collection:');
  await fixIndex('invoices', 'number_1');

  console.log('\nFixing bills collection:');
  await fixIndex('bills', 'number_1');

  console.log('\nDone. Invoice and Bill numbers are now unique per-company, not globally.');
  await mongoose.connection.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
