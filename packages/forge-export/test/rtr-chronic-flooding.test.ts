/** Installed-Forge parity for RTR #32, Chronic Flooding. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CHRONIC_FLOODING = parseCard({
  kind: 'enchantment',
  id: 'rtr-32-chronic-flooding-forge',
  name: 'Chronic Flooding',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 32 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: { enchant: 'land', modifications: [] },
  abilities: [
    {
      kind: 'triggered',
      condition: 'enchantedLandBecomesTapped',
      effects: [{ kind: 'millCards', count: 3, target: { kind: 'triggeringPlayer' } }],
    },
  ],
});

describe('Chronic Flooding Forge export', () => {
  it('matches the entire installed Forge script', () => {
    expect(mustTranspile(CHRONIC_FLOODING)).toBe(
      `${[
        'Name:Chronic Flooding',
        'ManaCost:1 U',
        'Types:Enchantment Aura',
        'K:Enchant:Land',
        'SVar:AttachAILogic:Curse',
        'T:Mode$ Taps | ValidCard$ Card.AttachedBy | TriggerZones$ Battlefield | Execute$ TrigMill | TriggerDescription$ Whenever enchanted land becomes tapped, its controller mills three cards.',
        'SVar:TrigMill:DB$ Mill | Defined$ TriggeredCardController | NumCards$ 3',
        'Oracle:Enchant land\\nWhenever enchanted land becomes tapped, its controller mills three cards.',
      ].join('\n')}\n`,
    );
  });
});
