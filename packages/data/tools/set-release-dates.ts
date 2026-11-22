import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { readSetReleaseDates } from '../src/printed-card/set-release-dates';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  allowPositionals: true,
  options: { database: { type: 'string' }, out: { type: 'string' } },
});
if (values.database === undefined || values.out === undefined || positionals.length === 0) {
  throw new Error('Usage: set-release-dates --database <sqlite> --out <json> <SET CODE>...');
}
const database = new Database(values.database, { readonly: true, fileMustExist: true });
try {
  writeFileSync(values.out, `${JSON.stringify(readSetReleaseDates(database, positionals))}\n`, {
    flag: 'wx',
  });
} finally {
  database.close();
}
