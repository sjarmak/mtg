/** Akroma's Memorial against Forge's current checked-in card script. */
import { parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const MEMORIAL = parseCard({
  kind: 'artifact',
  id: 'm13-akromas-memorial',
  name: "Akroma's Memorial",
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 200 },
  manaCost: { generic: 7 },
  supertypes: ['legendary'],
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      modification: {
        kind: 'grantKeywordAbilities',
        grants: [
          { kind: 'keyword', keyword: 'flying' },
          { kind: 'keyword', keyword: 'firstStrike' },
          { kind: 'keyword', keyword: 'vigilance' },
          { kind: 'keyword', keyword: 'trample' },
          { kind: 'keyword', keyword: 'haste' },
          { kind: 'protection', quality: { kind: 'color', color: 'B' } },
          { kind: 'protection', quality: { kind: 'color', color: 'R' } },
        ],
      },
    },
  ],
});

describe("Akroma's Memorial in Forge", () => {
  it('writes one ordered AddKeyword bundle with the exact printed description', () => {
    const script = mustTranspile(MEMORIAL);
    expect(script).toContain(
      'S:Mode$ Continuous | Affected$ Creature.YouCtrl | ' +
        'AddKeyword$ Flying & First Strike & Vigilance & Trample & Haste & Protection from black & Protection from red | ' +
        'Description$ Creatures you control have flying, first strike, vigilance, trample, haste, and protection from black and from red.',
    );
    expect(script.match(/^S:.*Creature\.YouCtrl.*$/gm)).toHaveLength(1);
    expect(script).toContain(`Oracle:${renderOracleText(MEMORIAL)}`);
  });
});
