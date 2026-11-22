/**
 * The landing gate for printed admissions: a change to ForgeBridge.java or the
 * adapter bundle must move every committed admission's binding in the same
 * branch. Fixture trees prove both directions; the last test reads the real tree.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { bundleInstalledForgeAdapter } from '../../tools/installed-adapter-bundle';
import {
  BRIDGE_SOURCE,
  describeStaleBindings,
  staleAdmissionBindings,
} from '../../tools/printed-admission-binding';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-admission-binding-test-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** A tree with the given format ids, each admitted against `bridge` and `adapterSha256`. */
function tree(ids: readonly string[], bridge: string, adapterSha256: string): void {
  write(join(root, BRIDGE_SOURCE), bridge);
  write(
    join(root, 'packages/data/data/printed-formats-v1.json'),
    JSON.stringify({
      schemaVersion: 1,
      formats: ids.map((id) => ({
        id,
        formatFile: `${id}-format.json`,
        admissionDirectory: 'play-admission-v1',
        availability: {
          browse: 'available',
          draft: 'available',
          sealed: 'available',
          play: { status: 'supported', reason: 'fixture' },
        },
        catalogs: [{ code: 'AAA', file: `${id}-catalog.json` }],
      })),
    }),
  );
  for (const id of ids) {
    const directory = join(root, 'packages/data/data', id, 'play-admission-v1');
    write(join(directory, BRIDGE_SOURCE), bridge);
    write(
      join(directory, 'admission.json'),
      JSON.stringify({ subject: { bridgeSha256: sha(`classes:${bridge}`), adapterSha256 } }),
    );
  }
}

it('passes a tree where the bridge, the adapter and every admission agree', () => {
  tree(['aaa', 'bbb'], 'class ForgeBridge {}', sha('adapter v1'));
  expect(staleAdmissionBindings({ repoRoot: root, adapterSha256: sha('adapter v1') })).toEqual([]);
});

it('fails when only the bridge moved, naming every format and the binding that moved', () => {
  tree(['aaa', 'bbb'], 'class ForgeBridge {}', sha('adapter v1'));
  write(join(root, BRIDGE_SOURCE), 'class ForgeBridge { int changed; }');
  const stale = staleAdmissionBindings({ repoRoot: root, adapterSha256: sha('adapter v1') });
  expect(stale.map((s) => [s.formatId, s.moved])).toEqual([
    ['aaa', 'bridge'],
    ['bbb', 'bridge'],
  ]);
  expect(stale[0]).toMatchObject({
    bound: sha('class ForgeBridge {}'),
    current: sha('class ForgeBridge { int changed; }'),
    pinnedSubjectSha256: sha('classes:class ForgeBridge {}'),
  });
  expect(describeStaleBindings(stale)).toContain('aaa: bridge moved');
});

it('fails when only the adapter bundle moved', () => {
  tree(['aaa'], 'class ForgeBridge {}', sha('adapter v1'));
  const stale = staleAdmissionBindings({ repoRoot: root, adapterSha256: sha('adapter v2') });
  expect(stale.map((s) => [s.formatId, s.moved, s.bound, s.current])).toEqual([
    ['aaa', 'adapter', sha('adapter v1'), sha('adapter v2')],
  ]);
});

it('flags only the format left behind when a lane re-binds some admissions and not others', () => {
  tree(['aaa', 'bbb'], 'class ForgeBridge {}', sha('adapter v1'));
  write(join(root, BRIDGE_SOURCE), 'class ForgeBridge { int v2; }');
  write(
    join(root, 'packages/data/data/aaa/play-admission-v1', BRIDGE_SOURCE),
    'class ForgeBridge { int v2; }',
  );
  expect(
    staleAdmissionBindings({ repoRoot: root, adapterSha256: sha('adapter v1') }).map((s) => s.formatId),
  ).toEqual(['bbb']);
});

it('binds every committed printed admission to the bridge source and adapter bundle in this checkout', async () => {
  const bundle = await bundleInstalledForgeAdapter(REPO_ROOT, join(root, 'adapter'));
  const adapterSha256 = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  const stale = staleAdmissionBindings({ repoRoot: REPO_ROOT, adapterSha256 });
  expect(
    stale,
    `${describeStaleBindings(stale)}\nRe-admit the formats in this branch (the launcher refuses them on runtime mismatch).`,
  ).toEqual([]);
}, 60_000);
