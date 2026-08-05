/**
 * Temporary CLI for adding a user, mirroring v2's src/add-user.js. This
 * goes away once the Phase 4 dashboard can do the same thing from the UI --
 * kept minimal on purpose.
 *
 * Usage: tsx src/cli/add-user.ts "<Name>" "<Goodreads ID>" "<Download path>" ["<Email>"]
 * Or, in the running container: node dist/cli/add-user.js ...
 */
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

const [name, goodreadsId, downloadPath, email] = process.argv.slice(2);

if (!name || !goodreadsId || !downloadPath) {
  console.error('Missing arguments.');
  console.log('\nUsage: add-user "<Name>" "<Goodreads ID>" "<Download path>" ["<Email>"]');
  console.log('Example: add-user "Alice" "104614681" "/downloads/Alice" "alice@example.com"');
  process.exit(1);
}

try {
  const inserted = db
    .insert(users)
    .values({ name, goodreadsId, downloadPath, email: email || null })
    .returning()
    .get();

  console.log(`Added user #${inserted.id}: ${inserted.name}`);
  console.log(`  Goodreads ID: ${inserted.goodreadsId}`);
  console.log(`  Download path: ${inserted.downloadPath}`);
  console.log(`  Email: ${inserted.email || '(none)'}`);
} catch (err: any) {
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    console.error('A user with this Goodreads ID already exists.');
  } else {
    console.error('Database error:', err?.message ?? err);
  }
  process.exit(1);
}
