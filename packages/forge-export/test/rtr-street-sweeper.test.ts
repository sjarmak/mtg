/** Street Sweeper parity against the installed Forge 2.0.14 card source. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const STREET_SWEEPER = parseCard({
  kind: 'creature',
  id: 'rtr-234-street-sweeper-forge',
  name: 'Street Sweeper',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 234 },
  manaCost: { generic: 6 },
  artifact: true,
  subtypes: ['Construct'],
  power: 4,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'destroyAttachedPermanents',
          target: { kind: 'targetPermanent', filter: { cardTypes: ['land'] } },
          filter: { subtypes: ['Aura'] },
        },
      ],
    },
  ],
});

describe('Street Sweeper Forge export', () => {
  it('matches the installed executable script and current Oracle', () => {
    expect(mustTranspile(STREET_SWEEPER)).toBe(
      [
        'Name:Street Sweeper',
        'ManaCost:6',
        'Types:Artifact Creature Construct',
        'PT:4/6',
        'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ Whenever this creature attacks, destroy all Auras attached to target land.',
        'SVar:Trig1Effect1:DB$ DestroyAll | ValidCards$ Card.Aura+AttachedTo Targeted | ValidTgts$ Land',
        'Oracle:Whenever this creature attacks, destroy all Auras attached to target land.',
        '',
      ].join('\n'),
    );
  });
});
