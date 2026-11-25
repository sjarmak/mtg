/**
 * Re-binds every registered printed format's play admission in one pass: the six-step recipe of
 * packages/data/data/isd/README.md (Play admission), looped over printed-formats-v1.json. Run it
 * from the repo root, on a tree whose adapter and bridge are FINAL (merge origin/main first, and
 * touch nothing under packages/engine/src, packages/dsl/src or packages/forge-export/{src/observed,
 * bridge} while it runs: an admission written against an adapter that then moves is stranded).
 *
 *   node packages/data/tools/printed-admission-rebind-all.mjs build <run directory> [format id ...]
 *   node packages/data/tools/printed-admission-rebind-all.mjs install <run directory>
 *
 * `build` never stops at a failed format: it prints one BUILT or FAILED line per format, writes
 * the new admission under the run directory (<run directory>/<id>/play-admission), and checks it
 * against the installed one (same cards, same decisions, same probe ids, only sha256 values
 * differ). `install` then replaces each BUILT format's packages/data/data/<id>/play-admission with
 * the new one. The directory name never changes, so neither the registry nor any test moves with
 * a re-bind. The probe runs boot Forge and take the host Forge lock.
 */
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const data = 'packages/data/data/';
const registryPath = `${data}printed-formats-v1.json`;
const ADAPTER_INPUTS = [
  'packages/engine/src',
  'packages/dsl/src',
  'packages/forge-export/src/observed',
  'packages/forge-export/bridge',
];
const [mode, runDir, ...only] = process.argv.slice(2);
if ((mode !== 'build' && mode !== 'install') || runDir === undefined) {
  throw new Error('usage: build|install <run directory> [format id ...]');
}
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')).formats;

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });
const sha = /^[0-9a-f]{64}$/u;
const shapeOf = (value) =>
  typeof value === 'string'
    ? sha.test(value)
      ? '<sha256>'
      : value
    : Array.isArray(value)
      ? value.map(shapeOf)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOf(item)]))
        : value;

/** First differing JSON paths between two already-shaped values. */
function differences(a, b, at = '$', found = []) {
  if (found.length >= 5) return found;
  if (JSON.stringify(a) === JSON.stringify(b)) return found;
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      differences(a[key], b[key], `${at}.${key}`, found);
    }
    return found;
  }
  found.push(`${at}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  return found;
}

function rebind(entry, results) {
  const id = entry.id;
  const started = Date.now();
  const dir = path.join(runDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const log = fs.openSync(path.join(dir, 'log.txt'), 'a');
  const oldDirectory = `${data}${id}/${entry.admissionDirectory}`;
  const newDirectory = path.join(dir, 'play-admission');
  const existingAdmission = JSON.parse(fs.readFileSync(`${oldDirectory}/admission.json`, 'utf8'));
  const catalogs = entry.catalogs.flatMap((c) => ['--catalog', `${data}${id}/${c.file}`]);
  const step = (label, command, args) => {
    fs.writeSync(log, `\n$ [${label}] ${command} ${args.join(' ')}\n`);
    const result = spawnSync(command, args, { stdio: ['ignore', log, log] });
    if (result.status !== 0) {
      throw new Error(`${label} exited ${result.status ?? result.signal}`);
    }
  };
  const tsx = (label, script, args) => step(label, 'node_modules/.bin/tsx', [script, ...args]);
  try {
    if (fs.existsSync(newDirectory)) throw new Error(`${newDirectory} already exists`);
    step('configs', process.execPath, ['packages/data/tools/printed-admission-rebind-configs.mjs', id, dir]);
    tsx('inventory', 'packages/data/tools/inventory-printed-decisions.ts', [
      ...catalogs,
      '--forge-scripts',
      'tools/forge/dist/res/cardsfolder/cardsfolder.zip',
      '--token-scripts',
      'tools/forge/dist/res/tokenscripts',
      '--output',
      `${dir}/decision-inventory/inventory.json`,
    ]);
    tsx('scenario-probes', 'packages/ui/tools/printed-probe-cli.ts', [
      ...['--config', `${dir}/scenario.json`, '--out', `${dir}/scenario-probes`],
      ...['--timeout-ms', '600000'],
    ]);
    tsx('qualification', 'packages/data/tools/build-script-qualification-bundle.ts', [
      ...['--evidence', `${dir}/scenario-probes`],
      ...['--inventory', `${dir}/decision-inventory/inventory.json`],
      ...['--out', `${dir}/script-qualifications`],
    ]);
    tsx('match-probes', 'packages/ui/tools/printed-probe-cli.ts', [
      ...['--config', `${dir}/match.json`, '--out', `${dir}/match-probes`],
      ...['--timeout-ms', '600000'],
    ]);
    tsx('admission', 'packages/data/tools/build-script-qualified-admission.ts', [
      ...['--format', `${data}${id}/${entry.formatFile}`],
      ...catalogs,
      ...['--qualifications', `${dir}/script-qualifications`],
      ...['--match-probes', `${dir}/match-probes`],
      ...(existingAdmission.generatedObjectPolicy === undefined
        ? []
        : ['--generated-object-policy', existingAdmission.generatedObjectPolicy]),
      ...['--out', newDirectory],
    ]);
    const read = (directory) => JSON.parse(fs.readFileSync(`${directory}/admission.json`, 'utf8'));
    const [before, after] = [existingAdmission, read(newDirectory)];
    const subjectMoved = Object.keys(after.subject).filter(
      (key) => JSON.stringify(after.subject[key]) !== JSON.stringify(before.subject[key]),
    );
    const drift = differences(shapeOf(before), shapeOf(after));
    if (drift.length > 0) throw new Error(`admission differs beyond digests: ${drift.join('; ')}`);
    const seconds = Math.round((Date.now() - started) / 1000);
    results.push({ id, status: 'BUILT', built: newDirectory, installed: oldDirectory });
    console.log(
      `BUILT  ${id}  ` +
        `${after.cards.length} cards, ${after.probes.length} probes, moved: ${subjectMoved.join(',')}  ${seconds}s`,
    );
  } catch (error) {
    results.push({ id, status: 'FAILED', reason: String(error.message) });
    console.log(`FAILED ${id}  ${error.message}  log: ${path.join(dir, 'log.txt')}`);
  } finally {
    fs.closeSync(log);
  }
}

function build() {
  const dirty = git('status', '--porcelain', '--', ...ADAPTER_INPUTS).stdout.trim();
  if (dirty !== '') throw new Error(`the adapter is not final; uncommitted edits:\n${dirty}`);
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const entries = registry.filter((entry) => only.length === 0 || only.includes(entry.id));
  const unknown = only.filter((id) => !registry.some((entry) => entry.id === id));
  if (unknown.length > 0) throw new Error(`No registered printed format ${unknown.join(', ')}`);
  console.log(`re-binding ${entries.length} of ${registry.length} formats at ${head}`);
  const results = [];
  for (const entry of entries) rebind(entry, results);
  const moved = git('diff', '--name-only', head, '--', ...ADAPTER_INPUTS).stdout.trim();
  if (moved !== '') console.log(`WARNING the adapter moved during the run:\n${moved}`);
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify({ head, results }, null, 2));
  const failed = results.filter((result) => result.status === 'FAILED').length;
  console.log(`${results.length - failed} BUILT, ${failed} FAILED`);
  process.exitCode = failed === 0 && moved === '' ? 0 : 1;
}

function install() {
  const { results } = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8'));
  for (const { id, status, built, installed } of results) {
    if (status !== 'BUILT') continue;
    if (!fs.existsSync(path.join(built, 'admission.json')))
      throw new Error(`${id}: ${built} has no admission`);
    fs.rmSync(installed, { recursive: true });
    fs.cpSync(built, installed, { recursive: true });
    console.log(`installed ${id}: ${built} -> ${installed}`);
  }
}

if (mode === 'build') build();
else install();
