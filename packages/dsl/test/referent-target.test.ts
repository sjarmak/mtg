/**
 * The three targeting modes that name what an *earlier effect in the same list*
 * already chose: "that creature", "that player", "that creature's controller".
 *
 * Before these kinds existed the vocabulary had no way to say it, and the
 * failure was silent rather than loud. A card written as two effects each
 * carrying `targetCreature` validates clean and plays as two independent
 * choices: Stabbing Pain (M11 #118, "Target creature gets -1/-1 until end of
 * turn. Tap that creature.") shrank one creature and tapped another, and
 * Chandra's Outrage (M11 #128) sent its second 2 damage to whoever cast it
 * rather than to the creature's controller. A refusal would have been a
 * missing card; this was a wrong one.
 *
 * These are back-references, not targets. CR 115.1 makes a target something a
 * spell *chooses*, and none of these choose: they read a slot that was already
 * chosen and, for `thatCreaturesController`, derive a player from it the way
 * CR 120.3 lets damage name a recipient without targeting it. So they sit
 * beside `triggeringCreature` and `selfCreature` as retained referents — empty
 * `TARGET_SPACES` rows, excluded from `effectChoosesTarget`, never counted
 * toward a fizzle. What separates them from those two is where the referent
 * comes from: an event for `triggeringCreature`, the ability's own source for
 * `selfCreature`, and here an earlier *slot on the same card*.
 *
 * Which earlier slot is derived rather than written down. An index field would
 * be a second encoding of the same fact and could disagree with the effect
 * list it points into after a reorder, so `referentSourceIndex` finds the one
 * earlier effect that chooses a target in the referent's space; zero of them
 * or more than one is a card with no single reading, and both are refused with
 * `ILLEGAL_REFERENT_TARGET` rather than resolved by a tie-break nobody printed.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, TargetKind } from '../src/index';
import {
  HAND_AUTHORED_TARGETS,
  isReferentTarget,
  legalTargetsFor,
  MODEL_TARGET_KINDS,
  REFERENT_TARGETS,
  renderOracleText,
  restrictionFitsTargetKind,
  safeParseCard,
  TARGET_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';
import { targetKindsCanCollide } from '../src/targets';

const THAT_CREATURE: TargetKind = 'thatCreature';
const THAT_PLAYER: TargetKind = 'thatPlayer';
const THAT_CONTROLLER: TargetKind = 'thatCreaturesController';

function instantInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-referent-probe',
    name: 'Probe Strike',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 1 },
    manaCost: { generic: 2, R: 2 },
    colors: ['R'],
    effects: [],
    ...overrides,
  };
}

/** Chandra's Outrage (M11 #128), structurally. */
const OUTRAGE_EFFECTS = [
  { kind: 'dealDamage', amount: 4, target: { kind: 'targetCreature' } },
  { kind: 'dealDamage', amount: 2, target: { kind: THAT_CONTROLLER } },
];

/** Stabbing Pain (M11 #118), structurally. */
const STABBING_EFFECTS = [
  { kind: 'pumpUntilEndOfTurn', power: -1, toughness: -1, target: { kind: 'targetCreature' } },
  { kind: 'tapPermanent', target: { kind: THAT_CREATURE } },
];

/** Sign in Blood (M11 #117, M13 #110), structurally. */
const SIGN_EFFECTS = [
  { kind: 'drawCards', count: 2, target: { kind: 'targetPlayer' } },
  { kind: 'loseLife', amount: 2, target: { kind: THAT_PLAYER } },
];

function codesOf(input: Record<string, unknown>): readonly string[] {
  const result = safeParseCard(input);
  if (result.ok) return [];
  return result.violations.map((found) => found.code);
}

describe('the three back-reference targeting modes', () => {
  it('are kinds the engine knows and the generator may not choose', () => {
    for (const kind of REFERENT_TARGETS) {
      expect(TARGET_KINDS).toContain(kind);
      expect([...MODEL_TARGET_KINDS]).not.toContain(kind);
      expect(isReferentTarget(kind)).toBe(true);
    }
  });

  it('were appended rather than inserted, so every recorded fill fixture still hashes', () => {
    // `@mtg/setgen` prints `LEGAL_TARGETS[kind]` verbatim into the fill prompt
    // and keys its recorded fixtures by that prompt's hash. Order is therefore
    // part of a checked-in artifact: a kind inserted mid-tuple would invalidate
    // every fixture on the shelf, and a kind that reached
    // `generatableTargets` would do it even at the end.
    expect(TARGET_KINDS.slice(-3)).toEqual([THAT_CREATURE, THAT_PLAYER, THAT_CONTROLLER]);
    expect([...MODEL_TARGET_KINDS]).toEqual(['anyTarget', 'targetCreature', 'targetPlayer', 'noTarget']);
  });

  it('are hand-authored onto the effect rows the three printed cards need', () => {
    expect(HAND_AUTHORED_TARGETS['dealDamage']).toContain(THAT_CONTROLLER);
    expect(HAND_AUTHORED_TARGETS['tapPermanent']).toContain(THAT_CREATURE);
    expect(HAND_AUTHORED_TARGETS['loseLife']).toContain(THAT_PLAYER);
    expect(legalTargetsFor('dealDamage')).toContain(THAT_CONTROLLER);
    expect(legalTargetsFor('tapPermanent')).toContain(THAT_CREATURE);
    expect(legalTargetsFor('loseLife')).toContain(THAT_PLAYER);
  });

  it('collide with nothing and carry no restriction, the footing every retained referent has', () => {
    for (const kind of REFERENT_TARGETS) {
      expect(restrictionFitsTargetKind(kind)).toBe(false);
      expect(targetKindsCanCollide(kind, 'targetCreature')).toBe(false);
      expect(targetKindsCanCollide(kind, kind)).toBe(false);
    }
  });
});

describe('the three printed shapes that wanted them', () => {
  it('validates the burn-plus-drain template and prints its second half as a derived player', () => {
    const card = parseCard(instantInput({ effects: OUTRAGE_EFFECTS }) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Probe Strike deals 4 damage to target creature. Probe Strike deals 2 damage to that creature's controller.",
    );
  });

  it('validates the shrink-then-tap template and prints one creature, not two', () => {
    const card = parseCard(
      instantInput({
        id: 'xmp-referent-pain',
        name: 'Probe Pain',
        manaCost: { B: 1 },
        colors: ['B'],
        effects: STABBING_EFFECTS,
      }) as CardInput,
    );
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Target creature gets -1/-1 until end of turn. Tap that creature.');
  });

  it('validates the draw-then-drain template, where the referent is a player rather than a creature', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'xmp-referent-sign',
      name: 'Probe Bargain',
      rarity: 'common',
      set: { code: 'XMP', collectorNumber: 2 },
      manaCost: { B: 2 },
      colors: ['B'],
      effects: SIGN_EFFECTS,
    } as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Target player draws two cards. That player loses 2 life.');
  });

  it('reads an earlier slot inside an activated ability, not only inside a spell', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'xmp-referent-drake',
      name: 'Probe Drake',
      rarity: 'common',
      set: { code: 'XMP', collectorNumber: 3 },
      manaCost: { generic: 2, B: 1 },
      colors: ['B'],
      subtypes: ['Drake'],
      keywords: [],
      power: 2,
      toughness: 2,
      abilities: [{ kind: 'activated', cost: { mana: { B: 1 }, tapSelf: false }, effects: STABBING_EFFECTS }],
    } as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      '{B}: Target creature gets -1/-1 until end of turn. Tap that creature.',
    );
  });
});

describe('the readings a back-reference must not be allowed to have', () => {
  it('refuses a referent with no earlier effect that chooses in its space', () => {
    expect(
      codesOf(
        instantInput({
          effects: [{ kind: 'dealDamage', amount: 2, target: { kind: THAT_CONTROLLER } }],
        }),
      ),
    ).toContain('ILLEGAL_REFERENT_TARGET');
  });

  it('refuses a referent with two earlier choosers, which is a card with two readings', () => {
    expect(
      codesOf(
        instantInput({
          effects: [
            { kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } },
            { kind: 'pumpUntilEndOfTurn', power: -1, toughness: -1, target: { kind: 'targetCreature' } },
            { kind: 'dealDamage', amount: 2, target: { kind: THAT_CONTROLLER } },
          ],
        }),
      ),
    ).toContain('ILLEGAL_REFERENT_TARGET');
  });

  it('refuses a chooser that names several objects, because "that creature" names one', () => {
    // "up to two target creatures" leaves the back-reference with no singular
    // antecedent, so the counted slot is not a candidate chooser at all and the
    // card is refused for having none rather than resolved against the first.
    expect(
      codesOf(
        instantInput({
          effects: [
            { kind: 'tapPermanent', target: { kind: 'targetCreature', count: 2 } },
            { kind: 'dealDamage', amount: 2, target: { kind: THAT_CONTROLLER } },
          ],
        }),
      ),
    ).toContain('ILLEGAL_REFERENT_TARGET');
  });

  it('refuses a referent inside an ability body just as it does inside a spell', () => {
    expect(
      codesOf({
        kind: 'creature',
        id: 'xmp-referent-orphan',
        name: 'Probe Orphan',
        rarity: 'common',
        set: { code: 'XMP', collectorNumber: 4 },
        manaCost: { generic: 2, B: 1 },
        colors: ['B'],
        subtypes: ['Drake'],
        keywords: [],
        power: 2,
        toughness: 2,
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfAttacks',
            effects: [{ kind: 'tapPermanent', target: { kind: THAT_CREATURE } }],
          },
        ],
      }),
    ).toContain('ILLEGAL_REFERENT_TARGET');
  });

  it('refuses every narrowing field on a referent slot, which has nothing left to narrow', () => {
    // The slot is already decided by the time the referent reads it, so a
    // restriction, a filter, a distinctness demand or a count would be a
    // constraint applied after the choice it was meant to constrain. Each of
    // these refusals falls out of the empty `TARGET_SPACES` row plus the rules
    // that were already there — none needed a referent-specific case.
    expect(
      codesOf(
        instantInput({
          manaCost: { B: 1 },
          colors: ['B'],
          effects: [
            STABBING_EFFECTS[0],
            { kind: 'tapPermanent', target: { kind: THAT_CREATURE, restriction: { kind: 'tapped' } } },
          ],
        }),
      ),
    ).toContain('ILLEGAL_TARGET_RESTRICTION');

    expect(
      codesOf(
        instantInput({
          manaCost: { B: 1 },
          colors: ['B'],
          effects: [
            STABBING_EFFECTS[0],
            { kind: 'tapPermanent', target: { kind: THAT_CREATURE, filter: { colors: ['B'] } } },
          ],
        }),
      ),
    ).toContain('ILLEGAL_TARGET_FILTER');

    expect(
      codesOf(
        instantInput({
          manaCost: { B: 1 },
          colors: ['B'],
          effects: [
            STABBING_EFFECTS[0],
            { kind: 'tapPermanent', target: { kind: THAT_CREATURE, distinct: true } },
          ],
        }),
      ),
    ).toContain('ILLEGAL_DISTINCT_TARGET');

    expect(
      codesOf(
        instantInput({
          manaCost: { B: 1 },
          colors: ['B'],
          effects: [STABBING_EFFECTS[0], { kind: 'tapPermanent', target: { kind: THAT_CREATURE, count: 2 } }],
        }),
      ),
    ).toContain('ILLEGAL_TARGET_COUNT');
  });
});
