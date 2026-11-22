/** Writes a printed format's closed decision-surface inventory to a new audit artifact. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildPrintedDecisionInventory } from '../src/printed-card/printed-decision-inventory';

const { values } = parseArgs({
  options: {
    catalog: { type: 'string', multiple: true },
    'forge-scripts': { type: 'string' },
    'token-scripts': { type: 'string' },
    output: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (!values.catalog?.length || !values['forge-scripts'] || !values['token-scripts'] || !values.output) {
  throw new Error(
    'Usage: inventory-printed-decisions --catalog <catalog.json> [--catalog <catalog.json>] --forge-scripts <cardsfolder.zip> --token-scripts <directory> --output <inventory.json>',
  );
}
const output = resolve(values.output);
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
const archive = resolve(values['forge-scripts']);
const tokenRoot = resolve(values['token-scripts']);
const inventory = buildPrintedDecisionInventory(
  values.catalog.map((path) => JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown),
  (path) => execFileSync('unzip', ['-p', archive, path], { timeout: 30_000, maxBuffer: 1024 * 1024 }),
  (name) => {
    const path = resolve(tokenRoot, `${name}.txt`);
    return existsSync(path) ? readFileSync(path) : undefined;
  },
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ output, summary: inventory.summary })}\n`);
