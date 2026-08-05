/**
 * Temporary CLI for listing users, mirroring v2's src/list-users.js. Goes
 * away once the Phase 4 dashboard exists.
 *
 * Usage: tsx src/cli/list-users.ts
 * Or, in the running container: node dist/cli/list-users.js
 */
import { listUsers } from '../db/repo.js';

const users = listUsers();

if (users.length === 0) {
  console.log('No users found. Add one with: add-user "<Name>" "<Goodreads ID>" "<Download path>"');
  process.exit(0);
}

console.log(`${users.length} user(s):\n`);
for (const user of users) {
  console.log(`#${user.id}  ${user.name}`);
  console.log(`  Goodreads ID: ${user.goodreadsId}`);
  console.log(`  Download path: ${user.downloadPath}`);
  console.log(`  Email: ${user.email || '(none)'}`);
  console.log('');
}
