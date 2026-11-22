/**
 * A slot's effect menu is enforced against every effect the card prints, not
 * against the one list a permanent leaves empty.
 *
 * `mtg-bc2.26.10`. `checkEffectKinds` read `cardOwnEffects`, which is
 * `card.effects` or every mode's effects and nothing else, while every other
 * reader in the package had moved to the walk that also descends into the
 * card's abilities. The gap was latent rather than live: `ROLE_PROFILES.cardKind`
 * is instant-or-sorcery, `carriesAbilities` is creature-or-artifact, so the
 * allocator builds no slot that states an effect menu and an ability kind at
 * once, and a census over all three shipped briefs at 75/180/249 cards found
 * both stated together zero times.
 *
 * Latent is not absent, and the thing keeping it latent is two unrelated
 * predicates in a file the menu check never reads. A slot stating both is
 * expressible by hand today — `spell-permanent-cards.test.ts`'s walker slot
 * already states one — so the guard is a hand-built slot rather than a
 * generated one, and it stays valid whichever way the allocator moves.
 *
 * The negative below is the other half. A slot that asked for a token-maker
 * asked for one verb, and the tokens minted carry printed lines of their own;
 * crediting those against the slot's menu would fail a card for what its token
 * does. `printedEffectKindsOnCard` is the walk that stops at the card, and
 * `checkAbilityKinds` stops there too.
 */
import { describe, expect, it } from 'vitest';
import { checkSlotConformance } from '@mtg/setgen';
import type { Slot } from '@mtg/setgen';
import type { Card, CardInput, EffectInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';

/** Every field a slot carries that no test here varies. */
const SLOT_BASE = {
  index: 0,
  collectorNumber: 1,
  keywords: [],
  effectKinds: [],
  abilityKinds: [],
  auraModifications: [],
  triggerConditions: [],
  mechanics: [],
  archetypes: [],
  signpost: false,
} as const;

/**
 * The co-occurring slot the allocator does not build: an effect menu and a
 * printed trigger on one creature.
 */
const TRIGGER_SLOT: Slot = {
  ...SLOT_BASE,
  id: 'CW07',
  rarity: 'common',
  color: 'W',
  cardKind: 'creature',
  role: 'creature',
  manaValueMin: 2,
  manaValueMax: 4,
  effectKinds: ['gainLife'],
  abilityKinds: ['triggered'],
};

function creatureWhoseTriggerDoes(name: string, effect: EffectInput): Card {
  return parseCard({
    kind: 'creature',
    id: `tst-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['W'],
    power: 2,
    toughness: 2,
    manaCost: { generic: 2, W: 1 },
    effects: [],
    abilities: [{ kind: 'triggered', condition: 'selfEnters', effects: [effect] }],
  } as CardInput);
}

function codes(slot: Slot, card: Card): readonly string[] {
  return checkSlotConformance(slot, card).map((item) => item.code);
}

describe('an effect printed inside an ability, against the slot that commissioned it', () => {
  it('passes the card whose trigger does what the menu named', () => {
    const card = creatureWhoseTriggerDoes('Menu Keeper', {
      kind: 'gainLife',
      amount: 2,
      target: { kind: 'noTarget' },
    });

    expect(codes(TRIGGER_SLOT, card)).toStrictEqual([]);
  });

  it('fails the card whose trigger does something else, which read as clean', () => {
    const card = creatureWhoseTriggerDoes('Menu Breaker', {
      kind: 'dealDamage',
      amount: 2,
      target: { kind: 'targetCreature' },
    });

    const findings = checkSlotConformance(TRIGGER_SLOT, card);
    expect(findings.map((item) => item.code)).toStrictEqual(['SLOT_EFFECT_NOT_ALLOWED']);
    // The message names the verb the card printed, because a targeted
    // regeneration is what this finding routes to.
    expect(findings[0]?.message).toContain('dealDamage');
    expect(findings[0]?.message).toContain('[gainLife]');
  });

  it('reads a mode the same way, which is the hole the old walk did catch', () => {
    const modal = parseCard({
      kind: 'instant',
      id: 'tst-menu-modal',
      name: 'Menu Modal',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      colors: ['W'],
      manaCost: { generic: 1, W: 1 },
      effects: [],
      modes: [
        { effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }] },
        { effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }] },
      ],
    } as CardInput);
    const spellSlot: Slot = {
      ...TRIGGER_SLOT,
      cardKind: 'instant',
      role: 'lifegain',
      abilityKinds: [],
    };

    expect(codes(spellSlot, modal)).toStrictEqual(['SLOT_EFFECT_NOT_ALLOWED']);
  });
});

describe("a token's own printed line, which is not the slot's menu", () => {
  it('passes a token-maker whose token gains life the slot never asked for', () => {
    const slot: Slot = { ...TRIGGER_SLOT, effectKinds: ['createToken'] };
    const card = creatureWhoseTriggerDoes('Token Warden', {
      kind: 'createToken',
      count: 1,
      token: {
        identity: 'menu-spirit-1-1',
        name: 'Spirit',
        power: 1,
        toughness: 1,
        subtypes: ['Spirit'],
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfDies',
            effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
          },
        ],
      },
    });

    expect(codes(slot, card)).toStrictEqual([]);
  });
});
