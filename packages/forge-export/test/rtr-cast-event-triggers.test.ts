/** Source-attested Forge parity for RTR multicolored cast triggers. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('RTR multicolored cast trigger Forge export', () => {
  it('emits the installed Guttersnipe cast filter and controller restriction', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-98',
      name: 'Guttersnipe',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 98 },
      manaCost: { generic: 2, R: 1 },
      colors: ['R'],
      subtypes: ['Goblin', 'Shaman'],
      keywords: [],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'triggered',
          condition: 'youCastInstantOrSorcery',
          effects: [{ kind: 'dealDamage', amount: 2, players: 'eachOpponent', target: { kind: 'noTarget' } }],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toContain(
      'T:Mode$ SpellCast | ValidCard$ Instant,Sorcery | ValidActivatingPlayer$ You | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ Whenever you cast an instant or sorcery spell, CARDNAME deals 2 damage to each opponent.',
    );
  });

  it('emits Forge Card.MultiColor with the controller restriction', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'rtr-103',
      name: 'Pyroconvergence',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 103 },
      manaCost: { generic: 4, R: 1 },
      colors: ['R'],
      subtypes: [],
      abilities: [
        {
          kind: 'triggered',
          condition: 'youCastSpell',
          spellIsMulticolored: true,
          effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toContain(
      'T:Mode$ SpellCast | ValidCard$ Card.MultiColor | ValidActivatingPlayer$ You | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ Whenever you cast a multicolored spell, CARDNAME deals 2 damage to any target.',
    );
  });
});
