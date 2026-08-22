/**
 * A key the DSL does not declare is refused by name, everywhere.
 *
 * `mtg-nhyv.69`. The repo already recorded that `CardSchema.safeParse` strips
 * unknown keys and that the way to validate a card is `validateCards`. That
 * rule was false where it mattered: Zod's object schemas strip by default, and
 * `validateCards` inherited the default, so five keys a plausible translation
 * would write were accepted and discarded. The caller got `[]` findings and a
 * card that quietly did something else — a discard cost that ate any card
 * rather than a creature, an exile that took the whole graveyard rather than
 * the nonland part of it, a shuffle that reached one player rather than each.
 *
 * The fix is one default rather than five patches, which is why the last test
 * here reads the source rather than a card: a sixth invented key has to be
 * refused without anybody writing a sixth test.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import { validateCards } from '../src/index';

const SET = { code: 'TST', collectorNumber: 1 };

function sorceryWith(effect: Record<string, unknown>): unknown {
  return {
    kind: 'sorcery',
    id: 'probe-spell',
    name: 'Probe Spell',
    rarity: 'common',
    set: SET,
    colors: ['B'],
    manaCost: { generic: 1, B: 1 },
    effects: [effect],
  };
}

function creatureWith(ability: Record<string, unknown>): unknown {
  return {
    kind: 'creature',
    id: 'probe-body',
    name: 'Probe Body',
    rarity: 'common',
    set: SET,
    colors: ['G'],
    manaCost: { generic: 1, G: 1 },
    power: 2,
    toughness: 2,
    abilities: [ability],
  };
}

/** Each row is a key that was accepted and thrown away, and where it attached. */
const INVENTED_KEYS: readonly {
  readonly key: string;
  readonly meaning: string;
  readonly card: unknown;
}[] = [
  {
    key: 'discardFilter',
    meaning: 'a discard cost that names which card, rather than any card',
    card: creatureWith({
      kind: 'activated',
      cost: { mana: {}, tapSelf: true, discard: 1, discardFilter: { cardTypes: ['creature'] } },
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    }),
  },
  {
    key: 'filter',
    meaning: 'an exile that leaves part of the graveyard behind',
    card: sorceryWith({
      kind: 'exileGraveyard',
      whose: 'opponent',
      filter: { cardTypes: ['creature'] },
    }),
  },
  {
    key: 'whose',
    meaning: 'a graveyard shuffled back by each player rather than by you',
    card: sorceryWith({ kind: 'shuffleGraveyardIntoLibrary', whose: 'each' }),
  },
  {
    key: 'whose',
    meaning: 'a library shuffled by the players a prior effect named',
    card: sorceryWith({ kind: 'shuffleLibrary', whose: 'each' }),
  },
  {
    key: 'zone',
    meaning: 'an ability activated from somewhere other than the battlefield',
    card: creatureWith({
      kind: 'activated',
      cost: { mana: { generic: 2, R: 1 } },
      zone: 'graveyard',
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    }),
  },
];

describe('a key the DSL does not declare', () => {
  for (const row of INVENTED_KEYS) {
    it(`is refused by name where it would have meant ${row.meaning}`, () => {
      const findings = validateCards([row.card as CardInput]);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.map((finding) => finding.message)).toContainEqual(expect.stringContaining(row.key));
    });
  }

  it('leaves a card that invents nothing alone', () => {
    expect(
      validateCards([
        sorceryWith({ kind: 'exileGraveyard', whose: 'opponent' }) as CardInput,
        creatureWith({
          kind: 'activated',
          cost: { mana: {}, tapSelf: true, discard: 1 },
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        }) as CardInput,
      ]),
    ).toEqual([]);
  });
});

describe('the refusal is a default rather than a list', () => {
  it('leaves no object schema in the DSL that still drops what it does not declare', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (/(?<![A-Za-z])z\.object\(/.test(readFileSync(path, 'utf8'))) offenders.push(path);
      }
    };
    walk(src);
    // `z.strictObject` is the whole fix. A `z.object` added tomorrow reopens
    // the hole for every key that schema does not declare, and it would reopen
    // it silently, which is the property this test exists to remove.
    expect(offenders).toEqual([]);
  });
});
