import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { fingerprintBotFiles } from '../src/bot-fingerprint';

it('fingerprints actual compiled classes, named resource trees, and runtime configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'mtg-bot-fingerprint-test-'));
  try {
    mkdirSync(join(root, 'classes'));
    const file = join(root, 'classes', 'Bot.class');
    writeFileSync(file, 'binary-one');
    const files = [{ name: 'compiled', path: join(root, 'classes') }];
    const first = fingerprintBotFiles('java17/hybrid', files);
    expect(fingerprintBotFiles('java17/hybrid', files)).toBe(first);
    expect(fingerprintBotFiles('java21/hybrid', files)).not.toBe(first);
    writeFileSync(file, 'binary-two');
    expect(fingerprintBotFiles('java17/hybrid', files)).not.toBe(first);
    expect(() => fingerprintBotFiles('java17', [{ name: 'missing', path: join(root, 'absent') }])).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
