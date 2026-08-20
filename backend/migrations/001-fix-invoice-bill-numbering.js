const mongoose = require('mongoose');

async function fixIndex(collectionName, oldIndexName) {
  const collection = mongoose.connection.collection(collectionName);
  const existingIndexes = await collection.indexes();

  const badIndex = existingIndexes.find(ix => ix.name === oldIndexName);
  if (badIndex) {
    await collection.dropIndex(oldIndexName);
    console.log(`    Dropped stale global index '${oldIndexName}' on ${collectionName}`);
  }

  await collection.createIndex(
    { companyId: 1, number: 1 },
    { unique: true, name: 'companyId_1_number_1' }
  );
  console.log(`    Ensured correct compound index (companyId + number) on ${collectionName}`);
}

module.exports = {
  name: '001-fix-invoice-bill-numbering',
  up: async () => {
    // The old schema had a bare unique:true on 'number', which MongoDB
    // enforces GLOBALLY across every company — not scoped per tenant.
    // Every company's numbering starts at INV-0001/BILL-YYYY-0001 by
    // default, so any two companies' first invoice or bill was guaranteed
    // to collide. This replaces that with a compound index scoped to
    // companyId, matching the pattern Account.js already used correctly.
    await fixIndex('invoices', 'number_1');
    await fixIndex('bills', 'number_1');
  }
};
