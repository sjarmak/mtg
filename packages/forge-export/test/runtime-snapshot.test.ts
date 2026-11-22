import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createForgeRuntimeSnapshot } from '../src/observed/runtime-snapshot';
import { measureForgeRuntime } from '../src/observed/runtime-identity';

let root: string;
const jar = 'forge-gui-desktop-2.0.14-jar-with-dependencies.jar';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-snapshot-test-'));
  mkdirSync(join(root, 'source/res/cardsfolder'), { recursive: true });
  mkdirSync(join(root, 'snapshots'));
  mkdirSync(join(root, 'classes'));
  writeFileSync(join(root, 'source', jar), 'jar');
  writeFileSync(join(root, 'source/res/cardsfolder/cardsfolder.zip'), 'scripts');
  writeFileSync(join(root, 'classes/ForgeBridge.class'), 'main');
  writeFileSync(join(root, 'classes/ForgeBridge$Session.class'), 'inner');
  writeFileSync(join(root, 'ForgeBridge.java'), 'source');
  writeFileSync(join(root, 'adapter.mjs'), 'adapter');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function options() {
  return {
    forgeHome: join(root, 'source'),
    bridge: { kind: 'compiled' as const, path: join(root, 'classes') },
    adapterBundlePath: join(root, 'adapter.mjs'),
    outputParent: join(root, 'snapshots'),
  };
}

it('measures independent copied artifacts that do not change with their sources', () => {
  const before = measureForgeRuntime(options());
  const snapshot = createForgeRuntimeSnapshot(options());
  try {
    expect(snapshot.identity).toEqual(before);
    expect(measureForgeRuntime(snapshot.inputs)).toEqual(before);
    writeFileSync(join(root, 'source', jar), 'changed jar');
    writeFileSync(join(root, 'source/res/cardsfolder/cardsfolder.zip'), 'changed scripts');
    writeFileSync(join(root, 'classes/ForgeBridge$Session.class'), 'changed inner');
    writeFileSync(join(root, 'adapter.mjs'), 'changed adapter');
    expect(measureForgeRuntime(options())).not.toEqual(before);
    expect(measureForgeRuntime(snapshot.inputs)).toEqual(before);
    expect(readFileSync(snapshot.inputs.adapterBundlePath, 'utf8')).toBe('adapter');
  } finally {
    snapshot.dispose();
  }
  snapshot.dispose();
  expect(readdirSync(join(root, 'snapshots'))).toEqual([]);
  expect(existsSync(join(root, 'source', jar))).toBe(true);
});

it('copies source-mode bridges and ignores writable profiles and unrelated installation files', () => {
  writeFileSync(join(root, 'source/forge.profile.properties'), 'private profile');
  const sourceOptions = {
    ...options(),
    bridge: { kind: 'source' as const, path: join(root, 'ForgeBridge.java') },
  };
  const snapshot = createForgeRuntimeSnapshot(sourceOptions);
  try {
    expect(snapshot.identity).toEqual(measureForgeRuntime(sourceOptions));
    expect(snapshot.inputs.bridge.kind).toBe('source');
    expect(existsSync(join(snapshot.inputs.forgeHome, 'forge.profile.properties'))).toBe(false);
    writeFileSync(sourceOptions.bridge.path, 'changed source');
    expect(readFileSync(snapshot.inputs.bridge.path, 'utf8')).toBe('source');
  } finally {
    snapshot.dispose();
  }
});

it.each(['source/res/link', 'classes/link'])(
  'rejects linked tree entries and removes partial snapshots: %s',
  (path) => {
    symlinkSync(join(root, 'adapter.mjs'), join(root, path));
    expect(() => createForgeRuntimeSnapshot(options())).toThrow(/symbolic link/i);
    expect(readdirSync(join(root, 'snapshots'))).toEqual([]);
  },
);

it('cleans up after missing input and does not remove unrelated siblings', () => {
  mkdirSync(join(root, 'snapshots/keep'));
  rmSync(join(root, 'adapter.mjs'));
  expect(() => createForgeRuntimeSnapshot(options())).toThrow();
  expect(readdirSync(join(root, 'snapshots'))).toEqual(['keep']);
  expect(() => createForgeRuntimeSnapshot({ ...options(), forgeHome: join(root, 'missing') })).toThrow(
    /not installed/i,
  );
});
