/**
 * The `export` command's exit codes and its two accepted input shapes.
 *
 * `set.json` on disk is never a bare array — it is `{ formatVersion, set:
 * {...}, cards: [...] }`, the shape `@mtg/setgen` writes. Every other set
 * reader (the card renderer, the art verifier, the `npm run play` launcher)
 * already accepts that shape; this command used to be one of the two that
 * refused it.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_SET } from '@mtg/dsl';
import { main } from '../src/cli';

describe('forge-export cli', () => {
  let directory: string;
  let out: string[];
  let errors: string[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mtg-forge-export-cli-'));
    out = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => out.push(parts.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => errors.push(parts.join(' ')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('refuses to run without a command, rather than picking one', async () => {
    await expect(main([])).resolves.toBe(2);
    expect(errors.join('\n')).toContain('usage');
  });

  it('refuses "export" without an out-dir', async () => {
    await expect(main(['export'])).resolves.toBe(2);
    expect(errors.join('\n')).toContain('usage');
  });

  it('exports the fixture set to the named directory and exits 0', async () => {
    const outDir = join(directory, 'custom');
    await expect(main(['export', outDir])).resolves.toBe(0);
    expect(out.length).toBeGreaterThan(0);
    for (const path of out) expect(existsSync(path)).toBe(true);
  });

  it('accepts a set document in the shape @mtg/setgen writes, same as every other set reader', async () => {
    const cardsFile = join(directory, 'set.json');
    writeFileSync(
      cardsFile,
      JSON.stringify({
        formatVersion: 1,
        set: { code: 'XMP', name: 'Fixture', theme: 'fixture', seed: 'fixture-seed', profile: 'fixture v1' },
        cards: EXAMPLE_SET,
      }),
      'utf8',
    );
    const outDir = join(directory, 'from-document');

    await expect(main(['export', outDir, cardsFile])).resolves.toBe(0);
    expect(out.length).toBeGreaterThan(0);
    for (const path of out) expect(existsSync(path)).toBe(true);
  });

  it('still accepts a bare JSON array of cards', async () => {
    const cardsFile = join(directory, 'cards.json');
    writeFileSync(cardsFile, JSON.stringify(EXAMPLE_SET), 'utf8');
    const outDir = join(directory, 'from-array');

    await expect(main(['export', outDir, cardsFile])).resolves.toBe(0);
    expect(out.length).toBeGreaterThan(0);
  });

  it('rejects a document with no "cards" field, and writes no file at all', async () => {
    const cardsFile = join(directory, 'nonsense.json');
    writeFileSync(cardsFile, '{"notCards": []}', 'utf8');
    const outDir = join(directory, 'never');

    await expect(main(['export', outDir, cardsFile])).rejects.toThrow(/array of cards/);
    expect(existsSync(outDir)).toBe(false);
  });

  it('rejects a "cards" field that is not an array', async () => {
    const cardsFile = join(directory, 'wrong-shape.json');
    writeFileSync(cardsFile, '{"cards": "nope"}', 'utf8');
    const outDir = join(directory, 'never-either');

    await expect(main(['export', outDir, cardsFile])).rejects.toThrow(/"cards" is string, not an array/);
    expect(existsSync(outDir)).toBe(false);
  });
});
