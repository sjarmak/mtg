/**
 * A modal spell (CR 700.2) through every `packages/setgen` set-wide walk that
 * reads a card's own effects.
 *
 * `be1b33b` fixed four sites in `dsl`, `deckbuild` and `forge-export`: a modal
 * card's real content lives in `card.modes`, one effect list per mode, and
 * `card.effects` is empty by construction, so a reader that walks only
 * `card.effects` sees a modal card and reports it as printing nothing. That
 * survey explicitly stopped at those three packages. `packages/setgen` is
 * this file's half of closing it: every function below reads a card with no
 * game in progress and no mode choice to resolve, so the correct fix is the
 * render/count-every-mode verdict — `cardOwnEffects` (`validate/mechanics.ts`)
 * flattens `card.modes` the same way `@mtg/dsl`'s own `setTokens` does for the
 * identical reason.
 *
 * Each `it` below is written to fail for the reason the fix exists, not
 * merely to exercise the function: the assertion is the property a modal
 * card's hidden content produces (a finding fires, a template differs, a
 * count includes it), never a hand-picked literal that would still pass if
 * the fix were reverted to reading `card.effects` alone.
 */
import { describe, expect, it } from 'vitest';
import type { Card, Effect } from '@mtg/dsl';
import { mana, parseCard } from '@mtg/dsl';
import {
  cardContribution,
  checkCardPie,
  checkMechanicsPrinted,
  checkSlotConformance,
  checkTokenDemand,
  designTemplate,
  isBlankCard,
  redFlagsFor,
  unprintedMechanics,
  unspentTokens,
} from '@mtg/setgen';
import type { DesiredMechanic, Entry, Slot } from '@mtg/setgen';

function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'CW01',
    index: 0,
    collectorNumber: 1,
    rarity: 'common',
    color: 'W',
    cardKind: 'sorcery',
    role: 'trick',
    manaValueMin: 2,
    manaValueMax: 3,
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
    ...overrides,
  };
}

/** A modal spell, built the same way `parseCard` requires (CR 700.2, `@mtg/dsl`'s `modal.ts`). */
function modalSpell(
  modes: readonly { readonly effects: readonly Effect[] }[],
  overrides: Record<string, unknown> = {},
): Card {
  return parseCard({
    id: 'tst-fork-in-the-road',
    name: 'Fork in the Road',
    kind: 'sorcery',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['G'],
    manaCost: mana({ generic: 2, G: 1 }),
    effects: [],
    modes,
    ...overrides,
  });
}

function mechanic(overrides: Partial<DesiredMechanic> = {}): DesiredMechanic {
  return {
    name: 'Waylay',
    description: 'A mode this set is built to print.',
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    triggerConditions: [],
    colors: [],
    ...overrides,
  };
}

const DRAW: Effect = { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } };
const GAIN: Effect = { kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } };
const DESTROY: Effect = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };
const KEY_TOKEN: Effect = {
  kind: 'createToken',
  count: 1,
  token: { name: 'Key', colors: [], subtypes: ['Key'], keywords: [] },
};
const SPRITE_TOKENS: Effect = {
  kind: 'createToken',
  count: 2,
  token: { name: 'Sprite', power: 1, toughness: 1, colors: [], subtypes: ['Sprite'], keywords: [] },
};

describe('a modal card through the token economy (mechanics.ts)', () => {
  it('counts a token minted inside a mode as minted, not as never printed', () => {
    const card = modalSpell([{ effects: [KEY_TOKEN] }, { effects: [DRAW] }]);
    const unspent = unspentTokens([card]);
    expect(unspent.map((item) => item.token.name)).toContain('Key');
    expect(unspent.find((item) => item.token.name === 'Key')?.mintedBy).toStrictEqual([card.id]);
  });

  it('fails the set when a token minted only inside a mode has no consumer', () => {
    const card = modalSpell([{ effects: [KEY_TOKEN] }, { effects: [DRAW] }]);
    const entries: Entry[] = [{ slot: slot(), card }];
    const findings = checkTokenDemand(entries);
    expect(findings.map((f) => f.code)).toStrictEqual(['TOKEN_MINTED_UNSPENT']);
    expect(findings[0]?.message).toContain('Key');
  });
});

describe('a mechanic word printed only inside a mode (mechanics.ts)', () => {
  it('counts it as printed, and still flags a sibling word the set never prints at all', () => {
    const card = modalSpell([{ effects: [KEY_TOKEN] }, { effects: [DRAW] }]);
    const desired = mechanic({ effectKinds: ['createToken', 'destroyPermanent'] });
    const missed = unprintedMechanics([card], [desired]);
    expect(missed).toHaveLength(1);
    expect(missed[0]?.printed).toContain('createToken');
    expect(missed[0]?.unprinted).toStrictEqual(['destroyPermanent']);

    const entries: Entry[] = [{ slot: slot({ mechanics: ['Waylay'] }), card }];
    const findings = checkMechanicsPrinted(entries, [desired]);
    expect(findings.map((f) => f.code)).toStrictEqual(['MECHANIC_PARTLY_PRINTED']);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('createToken');
    expect(findings[0]?.message).toContain('destroyPermanent');
  });
});

describe('New World Order red flags across modes (nwo.ts)', () => {
  it('counts every mode as a clause the reader must read, not zero clauses', () => {
    const card = modalSpell([{ effects: [SPRITE_TOKENS] }, { effects: [GAIN] }]);
    const flags = redFlagsFor(card);
    // Two modes, one effect each: the flattened clause count is 2, the same
    // as a fixed two-effect spell's, which is exactly the reading
    // `cardOwnEffects` restores.
    expect(flags).toContain('multiEffect');
    // The token-count red flag also lives inside `ownEffects`, and a mode is
    // exactly as much board complexity as a fixed effect printing the same
    // count.
    expect(flags).toContain('wideBoard');
  });
});

describe('color-pie gating through a mode (pie.ts)', () => {
  it('fails a card whose off-pie effect is printed only inside a mode', () => {
    // Green is off-pie for destroyPermanent in the 2021 mechanical color pie
    // (the same fact `validate.test.ts`'s "color-pie gating" describe pins
    // against a flat effect list).
    const card = modalSpell([{ effects: [DESTROY] }, { effects: [DRAW] }]);
    const findings = checkCardPie(slot({ color: 'G', cardKind: 'sorcery' }), card);
    expect(findings.map((f) => f.code)).toContain('OFF_PIE');
    expect(findings[0]?.message).toContain('destroyPermanent');
  });
});

describe('archetype contribution through a mode (contribution.ts)', () => {
  it('reads an effect kind hidden inside a mode into the subjects a payoff can match', () => {
    const card = modalSpell([{ effects: [SPRITE_TOKENS] }, { effects: [GAIN] }]);
    const contribution = cardContribution(slot({ cardKind: 'sorcery' }), card);
    expect(contribution.subjects).toContain('createToken');
  });

  it('does not call a spell inert when every one of its modes is inert', () => {
    const card = modalSpell([{ effects: [DRAW] }, { effects: [GAIN] }]);
    const contribution = cardContribution(slot({ cardKind: 'sorcery' }), card);
    expect(contribution.subjects.length).toBeGreaterThan(0);
    expect(contribution.inert).toBe(true);
  });
});

describe('design-template identity and blankness through modes (template.ts)', () => {
  it('is not a blank card merely because its flat effect list is empty', () => {
    const card = modalSpell([{ effects: [DRAW] }, { effects: [GAIN] }]);
    expect(card.effects).toStrictEqual([]);
    expect(isBlankCard(card)).toBe(false);
  });

  it('templates a "choose one" modal spell differently from a fixed spell printing the same union of effects', () => {
    const modal = modalSpell([{ effects: [DRAW] }, { effects: [GAIN] }]);
    const fixed = parseCard({
      id: 'tst-fixed-twin',
      name: 'Fixed Twin',
      kind: 'sorcery',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 2 },
      colors: ['G'],
      manaCost: mana({ generic: 2, G: 1 }),
      effects: [DRAW, GAIN],
    });
    expect(designTemplate(modal)).not.toBe(designTemplate(fixed));
  });
});

describe('slot conformance through a mode (conformance.ts)', () => {
  it('rejects a mode printing an effect kind the slot did not allocate', () => {
    const removalSlot = slot({
      cardKind: 'sorcery',
      color: 'G',
      manaValueMin: 1,
      manaValueMax: 5,
      effectKinds: ['destroyPermanent'],
      role: 'removalExile',
    });
    const card = modalSpell([{ effects: [DESTROY] }, { effects: [DRAW] }]);
    const findings = checkSlotConformance(removalSlot, card);
    expect(findings.map((f) => f.code)).toContain('SLOT_EFFECT_NOT_ALLOWED');
    expect(findings.find((f) => f.code === 'SLOT_EFFECT_NOT_ALLOWED')?.message).toContain('drawCards');
  });
});
