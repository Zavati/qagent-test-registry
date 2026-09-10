import fs from 'node:fs';
/** Apply all schema migrations to a fresh functional-test database, or only those after a tested migration. */
export function applyCurrentMigrations(db, after = 0) {
  const dir = new URL('../../migrations/', import.meta.url);
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    if (Number(name.slice(0, 4)) > after) db.exec(fs.readFileSync(new URL(name, dir), 'utf8'));
  }
}
