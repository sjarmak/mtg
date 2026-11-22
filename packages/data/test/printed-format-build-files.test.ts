import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format as prettierFormat, resolveConfig } from 'prettier';
import { afterEach, describe, expect, it } from 'vitest';
import { forgeScriptFileName, writePrintedFormat } from '../src/printed-card/format-build-files';
import { buildFixture, digest, recipe, script } from './printed-format-build-fixture';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function inputs() {
  const root = mkdtempSync(join(tmpdir(), 'printed-format-build-'));
  roots.push(root);
  const sourceRoot = join(root, 'sources');
  mkdirSync(sourceRoot);
  const fixture = buildFixture();
  for (const [file, bytes] of fixture.files) writeFileSync(join(sourceRoot, file), bytes);
  writeFileSync(join(sourceRoot, 'sources.json'), fixture.manifest);
  mkdirSync(join(root, 'l'));
  writeFileSync(join(root, 'l/lightning_bolt.txt'), script);
  const archive = join(root, 'cards.zip');
  execFileSync('zip', ['-q', archive, 'l/lightning_bolt.txt'], { cwd: root, timeout: 5000 });
  const config = join(root, 'recipe.json');
  writeFileSync(config, JSON.stringify(recipe));
  return { root, sourceRoot, archive, config, output: join(root, 'result'), forgeVersion: 'test-v1' };
}
const tool = fileURLToPath(new URL('../tools/build-printed-format.ts', import.meta.url));
const run = (args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', tool, ...args], { encoding: 'utf8', timeout: 10000 });

describe('printed-format artifact writer and CLI', () => {
  it('writes source-bound artifacts, caches repeated scripts, and retains an explicit non-admission result', async () => {
    const options = inputs();
    const report = await writePrintedFormat(options);
    const saved = JSON.parse(readFileSync(join(options.output, 'build-evidence.json'), 'utf8'));
    expect(saved).toEqual(report);
    expect(saved.status).toBe('catalog-only-not-play-admitted');
    expect(saved.metrics).toMatchObject({ modelCalls: 0, networkRequests: 0, scriptReads: 1, printings: 3 });
    expect(saved.metrics.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(saved.sourceSha256).toBe(digest(buildFixture().manifest));
    for (const [file, hash] of Object.entries(saved.artifactSha256)) {
      expect(digest(readFileSync(join(options.output, file), 'utf8'))).toBe(hash);
    }
    expect(readFileSync(join(options.output, 'sources.json'), 'utf8')).toBe(buildFixture().manifest);
    await expect(writePrintedFormat(options)).rejects.toThrow(/already exists/);
    expect(JSON.parse(readFileSync(join(options.output, 'build-evidence.json'), 'utf8'))).toEqual(saved);
  });

  it('emits every JSON artifact already prettier-formatted, sources.json excepted', async () => {
    const options = inputs();
    const report = await writePrintedFormat(options);
    for (const file of [...Object.keys(report.artifactSha256), 'build-evidence.json']) {
      if (file === 'sources.json') continue;
      const bytes = readFileSync(join(options.output, file), 'utf8');
      expect(await prettierFormat(bytes, { ...(await resolveConfig(file)), filepath: file }), file).toBe(
        bytes,
      );
    }
  });

  it('writes a constructed recipe as a constructed-format file over the same catalogs', async () => {
    const options = inputs();
    writeFileSync(
      options.config,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'constructed',
        id: 'precons',
        name: 'Precons',
        sourceCodes: ['AKH', 'HOU', 'MP2'],
        rules: { variant: 'commander', startingLife: 40 },
        decks: [
          {
            id: 'bolt',
            name: 'Bolt',
            commanders: [{ name: 'Lightning Bolt', setCode: 'AKH' }],
            cards: [{ name: 'Lightning Bolt', setCode: 'HOU', count: 99 }],
          },
        ],
      }),
    );
    const report = await writePrintedFormat(options);
    expect(report.formatId).toBe('precons');
    expect(Object.keys(report.artifactSha256)).toContain('precons-constructed-format-v1.json');
    expect(Object.keys(report.artifactSha256)).not.toContain('precons-limited-format-v1.json');
    const format = JSON.parse(
      readFileSync(join(options.output, 'precons-constructed-format-v1.json'), 'utf8'),
    );
    expect(format.kind).toBe('printed-constructed-format');
    expect(format.decks[0].cards[0].count).toBe(99);
    expect(report.catalogs.map((catalog) => catalog.code)).toEqual(['AKH', 'HOU', 'MP2']);
  });

  it.each([
    ['Lightning Bolt', 'lightning_bolt.txt'],
    ["Avacyn's Pilgrim", 'avacyns_pilgrim.txt'],
    ['Séance', 'seance.txt'],
    ['Jötun Grunt', 'jotun_grunt.txt'],
    ['Lim-Dûl the Necromancer', 'lim_dul_the_necromancer.txt'],
    ['Æther Vial', 'aether_vial.txt'],
  ])('names the Forge script for %s as %s, folding diacritics the way cardsfolder does', (name, file) => {
    expect(forgeScriptFileName(name)).toBe(file);
  });

  it('leaves no output for source checksum drift', async () => {
    const options = inputs();
    const file = readdirSync(options.sourceRoot).find((name) => name.endsWith('.scryfall.json'))!;
    writeFileSync(join(options.sourceRoot, file), '[]');
    await expect(writePrintedFormat(options)).rejects.toThrow(/checksum mismatch/);
    expect(readdirSync(options.root)).not.toContain('result');
  });

  it('leaves no output for an invalid recipe or absent script', async () => {
    const options = inputs();
    writeFileSync(options.config, JSON.stringify({ ...recipe, id: '../outside' }));
    await expect(writePrintedFormat(options)).rejects.toThrow();
    writeFileSync(options.config, JSON.stringify(recipe));
    execFileSync('zip', ['-q', join(options.root, 'other.zip'), 'recipe.json'], { cwd: options.root });
    await expect(
      writePrintedFormat({ ...options, archive: join(options.root, 'other.zip') }),
    ).rejects.toThrow(/missing Forge script/);
    expect(readdirSync(options.root)).not.toContain('result');
  });

  it('requires all explicit CLI inputs before IO', () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: build-printed-format');
  });

  it('prints help without requiring sources or creating artifacts', () => {
    const result = run(['--help']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Usage: build-printed-format');
    expect(result.stdout).toContain('does not admit play');
    expect(result.stderr).toBe('');
  });

  it('runs the actual CLI into a fresh directory and refuses a second run', () => {
    const options = inputs();
    const args = [
      '--config',
      options.config,
      '--sources',
      options.sourceRoot,
      '--forge-scripts',
      options.archive,
      '--forge-version',
      options.forgeVersion,
      '--out',
      options.output,
    ];
    const result = run(args);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('catalog-only-not-play-admitted');
    expect(run(args).status).toBe(1);
    expect(
      JSON.parse(readFileSync(join(options.output, 'akh-hou-limited-format-v1.json'), 'utf8')).draft,
    ).toEqual(recipe.draft);
  });
});
