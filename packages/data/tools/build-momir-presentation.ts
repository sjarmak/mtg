import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { buildMomirPresentationCatalog } from '../src/printed-card/momir-presentation';

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  allowPositionals: false,
  options: { database: { type: 'string' }, out: { type: 'string' } },
});
if (values.database === undefined || values.out === undefined) {
  throw new Error('Usage: build-momir-presentation --database <sqlite> --out <json>');
}
const database = new Database(values.database, { readonly: true, fileMustExist: true });
try {
  const catalog = buildMomirPresentationCatalog(database);
  writeFileSync(values.out, `${JSON.stringify(catalog)}\n`, { flag: 'wx' });
} finally {
  database.close();
}
