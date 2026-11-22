/**
 * A set file is validated the way a card list is.
 *
 * `mtg-6lny`: `parseSetFile` was `SetFileSchema.parse` and nothing else, and
 * `SetFileSchema.cards` is `z.array(CardSchema)` — the zod shape. Every
 * structural check the DSL owns lives in `validateCardRecord`, which only
 * `parseCard` / `parseCards` reached. So the door every surface reads a set
 * through was the one door that skipped them, and the cheapest thing to slip
 * past it was `ORACLE_TEXT_MISMATCH`: a cached sentence that no longer renders
 * from the card under it. That is not a cosmetic drift. A card face prints
 * `card.oracleText` straight, and an art brief is written from the rendered
 * text, so a stale cache is a picture bought from one sentence and a card that
 * prints another.
 *
 * It refuses rather than repairing. Repairing would leave the file on disk and
 * the set in memory disagreeing, which is the same failure one layer along.
 *
 * The first row is the sweep that made the change safe, kept as a gate: every
 * committed set file, discovered rather than listed, so a fifth one is covered
 * the day it lands instead of the day somebody remembers this file. Measured
 * 2026-08-27 — the three setgen fixtures and `@mtg/dsl`'s `lantern-fen` all
 * pass, so strictness here costs nothing today and refuses only the stale
 * builds under `out/`, which are untracked and which the launcher already drops
 * rather than serving.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CardValidationError } from '@mtg/dsl';
import { parseSetFile, SetFileSchema } from '../src/index';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = resolve(PACKAGE_ROOT, '..');
const FLAGSHIP = join(PACKAGE_ROOT, 'fixtures', 'sets', 'tideglass-reach.set.json');

/** Every `*.set.json` under a package's `fixtures/sets`, in package order. */
function committedSetFiles(): readonly string[] {
  const found: string[] = [];
  for (const pkg of readdirSync(PACKAGES_DIR).sort()) {
    const dir = join(PACKAGES_DIR, pkg, 'fixtures', 'sets');
    let entries: readonly string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const entry of entries) if (entry.endsWith('.set.json')) found.push(join(dir, entry));
  }
  return found;
}

/** The flagship as a plain record, so a test can bend one field of it. */
function flagshipRecord(): Record<string, unknown> {
  return JSON.parse(readFileSync(FLAGSHIP, 'utf8')) as Record<string, unknown>;
}

/** The same file with the named cards' cached oracle text set to a lie. */
function withStaleOracleText(ids: readonly string[]): Record<string, unknown> {
  const file = flagshipRecord();
  const cards = file['cards'] as Record<string, unknown>[];
  for (const id of ids) {
    const card = cards.find((one) => one['id'] === id);
    if (card === undefined) throw new Error(`fixture no longer carries ${id}`);
    card['oracleText'] = 'Whenever another creature you control enters, draw a card.';
  }
  return file;
}

describe('every committed set file', () => {
  const files = committedSetFiles();

  it('finds the set files it is meant to gate', () => {
    expect(files.length, `looked under ${PACKAGES_DIR}/*/fixtures/sets`).toBeGreaterThanOrEqual(2);
  });

  it.each(files.map((path) => [path.slice(PACKAGES_DIR.length + 1), path] as const))(
    '%s parses through the strict door',
    (_label: string, path: string) => {
      const set = parseSetFile(JSON.parse(readFileSync(path, 'utf8')) as unknown);
      expect(set.cards.length).toBeGreaterThan(0);
    },
  );
});

describe('parseSetFile', () => {
  it('refuses a cached oracle text that disagrees with the card under it', () => {
    expect(() => parseSetFile(withStaleOracleText(['tgr-saltshrine-acolyte']))).toThrow(CardValidationError);
  });

  it('names the card the reader has to go fix', () => {
    let thrown: CardValidationError | null = null;
    try {
      parseSetFile(withStaleOracleText(['tgr-saltshrine-acolyte']));
    } catch (error: unknown) {
      thrown = error instanceof CardValidationError ? error : null;
    }
    expect(thrown, 'expected a CardValidationError').not.toBeNull();
    const violations = thrown?.violations ?? [];
    expect(violations.map((one) => one.code)).toContain('ORACLE_TEXT_MISMATCH');
    // The path is repathed from the card's root to the set file's, because
    // `oracleText` alone does not say which card to open.
    const oracle = violations.find((one) => one.code === 'ORACLE_TEXT_MISMATCH');
    expect(oracle?.path).toMatch(/^cards\[\d+] tgr-saltshrine-acolyte\.oracleText$/);
    expect(thrown?.message).toContain('set TGR carries 1 card(s) the DSL refuses');
  });

  it('reports every illegal card rather than stopping at the first', () => {
    let thrown: CardValidationError | null = null;
    try {
      parseSetFile(withStaleOracleText(['tgr-saltshrine-acolyte', 'tgr-reefclan-harpooner']));
    } catch (error: unknown) {
      thrown = error instanceof CardValidationError ? error : null;
    }
    expect(thrown?.message).toContain('set TGR carries 2 card(s) the DSL refuses');
    const ids = (thrown?.violations ?? []).map((one) => one.path);
    expect(ids.some((path) => path.includes('tgr-saltshrine-acolyte'))).toBe(true);
    expect(ids.some((path) => path.includes('tgr-reefclan-harpooner'))).toBe(true);
  });

  /**
   * `SetFileSchema` stays the shape-only door, and one caller wants it.
   *
   * `blocksAtRevision` (the art pipeline's brief-drift triage) reads old revisions of
   * a set file out of git to find the block a brief was authored from. Measured
   * over the 45 committed revisions of the three set fixtures, 26 are
   * shape-valid and structurally refused, almost all for a cached `oracleText`
   * that a later print-template change made stale. Holding archaeology to
   * today's structural rules would lose 26 revisions to `UnreadableRevision` and
   * blame the briefs for it. A set file somebody is about to play, plan art
   * against or ship goes through `parseSetFile`; a set file being read as
   * history goes through the schema.
   */
  it('leaves the shape-only door open for the callers reading history', () => {
    const bent = withStaleOracleText(['tgr-saltshrine-acolyte']);
    expect(() => parseSetFile(bent)).toThrow(CardValidationError);
    expect(SetFileSchema.parse(bent).cards.length).toBeGreaterThan(0);
  });

  it('still reports a malformed file as a shape error, not as a card violation', () => {
    const file = flagshipRecord();
    delete file['formatVersion'];
    expect(() => parseSetFile(file)).toThrow(/formatVersion/);
    expect(() => parseSetFile(file)).not.toThrow(CardValidationError);
  });
});
