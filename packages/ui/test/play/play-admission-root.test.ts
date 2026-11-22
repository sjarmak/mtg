import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ADMISSION_OWNER_FILENAME, createPlayAdmissionRoot } from '../../tools/play-admission-root';

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'mtg-play-admission-root-test-'));
});

afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

it('removes dead admission siblings and preserves a live owner', () => {
  const parent = join(repoRoot, 'out', 'play-admission');
  const dead = join(parent, '101-dead');
  const live = join(parent, '202-live');
  mkdirSync(dead, { recursive: true });
  mkdirSync(live);
  writeFileSync(join(dead, ADMISSION_OWNER_FILENAME), '101\n', 'utf8');
  writeFileSync(join(live, ADMISSION_OWNER_FILENAME), '202\n', 'utf8');

  const owned = createPlayAdmissionRoot(repoRoot, 303, (pid) => pid === 202);

  expect(existsSync(dead)).toBe(false);
  expect(existsSync(live)).toBe(true);
  expect(owned.startsWith(`${parent}/303-`)).toBe(true);
  expect(readFileSync(join(owned, ADMISSION_OWNER_FILENAME), 'utf8')).toBe('303\n');
});
