/** Source-attested Forge parity for M13 Quirion Dryad. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { FORGE_EFFECTS } from '../src/effect-script';
import { mustTranspile } from './helpers';

const PINNED_FORGE_REVISION = 'd6465382e4455ebfb3d77c297a56f30b929cb520';

describe('Quirion Dryad Forge export', () => {
  it('declares the source-creature counter target in the Forge vocabulary', () => {
    expect([...FORGE_EFFECTS.putCounters.targets]).toContain('selfCreature');
  });

  it('emits the pinned SpellCast color filter and controller restriction', () => {
    expect(PINNED_FORGE_REVISION).toMatch(/^[0-9a-f]{40}$/u);
    const card = parseCard({
      kind: 'creature',
      id: 'm13-184-quirion-dryad',
      name: 'Quirion Dryad',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 184 },
      manaCost: { generic: 1, G: 1 },
      colors: ['G'],
      subtypes: ['Dryad'],
      power: 1,
      toughness: 1,
      keywords: [],
      abilities: [
        {
          kind: 'triggered',
          condition: 'youCastSpell',
          spellColors: ['W', 'U', 'B', 'R'],
          effects: [
            {
              kind: 'putCounters',
              counter: 'plusOnePlusOne',
              count: 1,
              target: { kind: 'selfCreature' },
            },
          ],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toContain(
      "T:Mode$ SpellCast | ValidCard$ Card.White,Card.Blue,Card.Black,Card.Red | ValidActivatingPlayer$ You | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ Whenever you cast a spell that's white, blue, black, or red, put a +1/+1 counter on this creature.",
    );
  });
});
