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
 * play-admission-v<N+1> beside the installed vN, and checks the new admission against the old one
 * (same cards, same decisions, same probe ids, only sha256 values differ). `install` then points
 * the registry, the per-format tests and the registry test at each BUILT format's new directory
 * and deletes the superseded one. The probe runs boot Forge and take the host Forge lock.
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
const nextDirectory = (entry) =>
  `play-admission-v${Number(/^play-admission-v(\d+)$/u.exec(entry.admissionDirectory)[1]) + 1}`;

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
  const newDirectory = `${data}${id}/${nextDirectory(entry)}`;
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
    results.push({ id, status: 'BUILT', from: entry.admissionDirectory, to: nextDirectory(entry) });
    console.log(
      `BUILT  ${id}  ${entry.admissionDirectory} -> ${nextDirectory(entry)}  ` +
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
  let registryText = fs.readFileSync(registryPath, 'utf8');
  const replaceIn = (file, from, to) => {
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(from)) fs.writeFileSync(file, text.replaceAll(from, to));
  };
  for (const { id, status, from, to } of results) {
    if (status !== 'BUILT') continue;
    const entryPattern = new RegExp(`("id": "${id}"[\\s\\S]*?"admissionDirectory": ")${from}(")`, 'u');
    if (!entryPattern.test(registryText)) throw new Error(`${id}: registry does not name ${from}`);
    registryText = registryText.replace(entryPattern, `$1${to}$2`);
    replaceIn(`packages/data/test/${id}-printed-format.test.ts`, `${from}/`, `${to}/`);
    if (['rtr', 'm11', 'm13'].includes(id)) {
      replaceIn('packages/data/test/rtr-m11-m13-printed-formats.test.ts', `${from}'`, `${to}'`);
    }
    replaceIn(
      'packages/ui/test/tools/printed-format-registry.test.ts',
      `data/${id}/${from}'`,
      `data/${id}/${to}'`,
    );
    replaceIn(
      'packages/ui/test/tools/admitted-printed-backend-runtime-mismatch.test.ts',
      `data/${id}/${from}/`,
      `data/${id}/${to}/`,
    );
    replaceIn(
      'packages/ui/test/tools/stage-printed-formats.test.ts',
      `data, '${from}'`,
      `data, '${to}'`,
    );
    replaceIn(
      'packages/ui/test/lab/printed-limited-constructed.test.ts',
      `\${data}/${from}/`,
      `\${data}/${to}/`,
    );
    fs.rmSync(`${data}${id}/${from}`, { recursive: true });
    console.log(`installed ${id}: ${from} -> ${to}`);
  }
  fs.writeFileSync(registryPath, registryText);
}

if (mode === 'build') build();
else install();
