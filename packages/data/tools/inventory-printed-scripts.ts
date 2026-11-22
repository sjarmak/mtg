/** Read-only inventory producer. Redirect stdout to a local audit artifact if needed. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildPrintedScriptInventory } from '../src/printed-card/script-inventory';

const { values } = parseArgs({
  options: {
    catalog: { type: 'string', multiple: true },
    'forge-scripts': { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (!values.catalog?.length || !values['forge-scripts']) {
  throw new Error(
    'Usage: inventory-printed-scripts --catalog <catalog.json> [--catalog <catalog.json>] --forge-scripts <cardsfolder.zip>',
  );
}
const archive = resolve(values['forge-scripts']);
const inventory = buildPrintedScriptInventory(
  values.catalog.map((path) => JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown),
  (member) => execFileSync('unzip', ['-p', archive, member], { maxBuffer: 1024 * 1024 }),
);
const archiveSha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
process.stdout.write(`${JSON.stringify({ ...inventory, archiveSha256 }, null, 2)}\n`);
