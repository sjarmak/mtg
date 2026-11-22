import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureProbeSources } from '../../tools/printed-probe-sources';

it('binds nested support files, their content, and additions to probe provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'probe-sources-'));
  try {
    const support = join(root, 'packages/forge-export/test/support');
    await mkdir(join(support, 'nested'), { recursive: true });
    const test = join(root, 'probe.test.ts');
    const helper = join(support, 'nested/assertions.ts');
    await writeFile(test, 'test');
    await writeFile(helper, 'before');
    const before = await captureProbeSources(root, [test, test]);
    expect(before.map((source) => source.path)).toEqual([helper, test].sort());
    expect(before.every((source) => /^[a-f0-9]{64}$/.test(source.sha256))).toBe(true);
    await writeFile(helper, 'after');
    expect(await captureProbeSources(root, [test])).not.toEqual(before);
    await writeFile(helper, 'before');
    expect(await captureProbeSources(root, [test])).toEqual(before);
    await writeFile(join(support, 'new.json'), '{}');
    expect(await captureProbeSources(root, [test])).toHaveLength(3);
    await rm(helper);
    expect(await captureProbeSources(root, [test])).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('refuses symlinked support inputs and missing selected tests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'probe-sources-'));
  try {
    const support = join(root, 'packages/forge-export/test/support');
    await mkdir(support, { recursive: true });
    const target = join(root, 'target.ts');
    await writeFile(target, 'target');
    await symlink(target, join(support, 'linked.ts'));
    await expect(captureProbeSources(root, [target])).rejects.toThrow('Unsupported probe source');
    await rm(join(support, 'linked.ts'));
    await expect(captureProbeSources(root, [join(root, 'missing.ts')])).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
