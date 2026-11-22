/**
 * Who prices a card with no deck in hand, and how much that costs them.
 *
 * `evaluateCard`'s third argument is optional, and a caller that omits it gets
 * the context-free arm: every deck-conditioned factor falls back to its
 * unconditioned value, which for the two sacrifice-cost factors is a supply of
 * 1 — an outlet that eats two Parts is priced as though the deck could always
 * feed it, in a pool that mints none. `deck-pricing.ts`'s header argues that
 * caller by caller. This file is what keeps that argument honest: the census it
 * names is derived here from the checkout rather than remembered, so a ninth
 * source surface fails this test instead of quietly joining a list nobody
 * re-reads.
 *
 * It also pins the *direction*, which is the load-bearing half of the argument.
 * Both supply factors are probabilities, so they only ever multiply a price
 * down: a context-free score is a ceiling on the deck-conditioned one for any
 * card whose sole deck-reading clause is a sacrifice cost. Every caller below
 * is allowed to be context-free because being handed a ceiling is safe for what
 * it does with the number, and that stops being true the moment the fallback
 * stops being 1.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { deckContextOf, DEFAULT_DECK_BUILD_CONFIG, DEFAULT_SCORE_WEIGHTS, evaluateCard } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Every file that prices a card without a deck, and how many times.
 *
 * Shipped surfaces only — `src/` and `tools/`, never `test/`, because a test
 * that scores a card in isolation is asking about the isolation. The eight
 * source surfaces are argued in `deck-pricing.ts`; construction and native
 * draft establish a context-free first pass before applying deck context,
 * reporting surfaces print the ceiling and say so, and `@mtg/draft-export`'s
 * rating keeps the ceiling as a deliberate baseline (`mtg-s230`, measured in
 * `rating.ts` and pinned by
 * `@mtg/draft-export`'s `outlet-rating.test.ts`).
 */
const CENSUS: ReadonlyMap<string, number> = new Map([
  ['packages/deckbuild/src/evaluate.ts', 1],
  ['packages/draft-export/src/draft.ts', 1],
  ['packages/draft-export/src/native-draft-bot.ts', 2],
  ['packages/draft-export/src/rating.ts', 1],
  ['packages/metrics/tools/color-census.ts', 3],
  ['packages/metrics/tools/color-drift.ts', 1],
  ['packages/setgen/src/validate/rate.ts', 1],
  ['packages/ui/tools/design-review-page.ts', 1],
]);

function typeScriptFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) typeScriptFiles(path, found);
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

function shippedSourceDirectories(): readonly string[] {
  const directories: string[] = [];
  for (const entry of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const sub of ['src', 'tools']) {
      const dir = join(ROOT, 'packages', entry.name, sub);
      if (existsAsDirectory(dir)) directories.push(dir);
    }
  }
  return directories;
}

function existsAsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Blanks comments while keeping every offset, so a call written inside a
 * docblock is not counted and a line number stays a line number. `rate.ts`
 * prints its own formula in prose, and reading that as a caller is how a
 * source-scanning census gets its first false positive.
 */
function withoutComments(text: string): string {
  const blank = (matched: string): string => matched.replace(/[^\n]/g, ' ');
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, blank);
}

/** The top-level arguments of the call whose opening parenthesis is at `open`. */
function callArguments(text: string, open: number): readonly string[] | null {
  let depth = 0;
  const args: string[] = [];
  let start = open + 1;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth === 0) {
        args.push(text.slice(start, index));
        return args;
      }
    } else if (character === ',' && depth === 1) {
      args.push(text.slice(start, index));
      start = index + 1;
    }
  }
  return null;
}

interface Call {
  readonly file: string;
  readonly line: number;
  readonly arity: number;
}

function callsIn(path: string): readonly Call[] {
  const text = withoutComments(readFileSync(path, 'utf8'));
  const file = path.slice(ROOT.length);
  const pattern = /(?<![\w$])evaluateCard\(/g;
  const calls: Call[] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    const before = text.slice(0, match.index);
    // A member access is somebody else's `evaluateCard`; a spread's three dots
    // are not one. The declaration is not a call.
    const isMemberAccess = before.endsWith('.') && !before.endsWith('...');
    if (!isMemberAccess && !/\bfunction\s+$/.test(before)) {
      const args = callArguments(text, match.index + match[0].length - 1);
      if (args === null) throw new Error(`unbalanced evaluateCard( call in ${file}`);
      calls.push({ file, line: before.split('\n').length, arity: args.length });
    }
    match = pattern.exec(text);
  }
  return calls;
}

function contextFreeCensus(): ReadonlyMap<string, number> {
  const census = new Map<string, number>();
  for (const directory of shippedSourceDirectories()) {
    for (const path of typeScriptFiles(directory)) {
      for (const call of callsIn(path)) {
        if (call.arity >= 3) continue;
        census.set(call.file, (census.get(call.file) ?? 0) + 1);
      }
    }
  }
  return census;
}

let nextNumber = 1;
function card(input: Partial<CardInput> & { readonly id: string }): Card {
  nextNumber += 1;
  return parseCard({
    name: input.id,
    rarity: 'common',
    set: { code: 'CFC', collectorNumber: nextNumber },
    ...input,
  } as CardInput);
}

const OUTLET = card({
  id: 'outlet',
  kind: 'creature',
  manaCost: { generic: 2, W: 1 },
  colors: ['W'],
  subtypes: ['Scout'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 }, sacrificeOther: { count: 1, subtype: 'Part' } },
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

const MINTER = card({
  id: 'minter',
  kind: 'sorcery',
  manaCost: { generic: 1, W: 1 },
  colors: ['W'],
  effects: [
    {
      kind: 'createToken',
      count: 1,
      token: { name: 'Shard', power: 0, toughness: 1, colors: [], subtypes: ['Part'], keywords: [] },
    },
  ],
});

const config = DEFAULT_DECK_BUILD_CONFIG;
const weights = DEFAULT_SCORE_WEIGHTS;

describe('the context-free arm of the evaluator', () => {
  it('is reached from the eight shipped source surfaces the argument names', () => {
    expect([...contextFreeCensus()].sort()).toEqual([...CENSUS].sort());
  });

  it('sees every call in this package, so a miss would be a scanner bug', () => {
    const calls = callsIn(join(ROOT, 'packages/deckbuild/src/deck-pricing.ts'));
    expect(calls.map((call) => call.arity)).toEqual([3, 3, 3]);
  });

  it('prices a sacrifice outlet at a ceiling, never under the deck it is in', () => {
    const free = evaluateCard(OUTLET, weights).score;
    const fed = evaluateCard(OUTLET, weights, deckContextOf([OUTLET, MINTER], config)).score;
    const starved = evaluateCard(OUTLET, weights, deckContextOf([OUTLET], config)).score;
    expect(free).toBeGreaterThan(fed);
    expect(fed).toBeGreaterThan(starved);
  });
});
