/**
 * Every card shape the DSL can print is either priced by `evaluateCard` or
 * declared unpriced here with a reason (`mtg-tqe4`).
 *
 * The defect this covers is a hole rather than a wrong number, and it has now
 * been found three times by three unrelated greps: `card.keywordAbilities`
 * (`mtg-gloz`), `card.costReduction` (`mtg-tqe4`), and the four this suite
 * turned up on its first run. Each time the evaluator read a field it had never
 * been taught about, scored two different cards as one number, and nothing
 * failed. Three point fixes do not close a class, so this enumerates the class.
 *
 * **Why `CARD_SHAPES` and not the effect, ability and keyword unions the bead
 * names.** Those three are already total by construction and cannot go stale:
 * `effectValue`, `keywordBase`, `keywordPowerScale`, `keywordAbilityValue`,
 * `effectScopeReach` and `EFFECT_PRICING` are `Record<Union, ...>`, so adding a
 * member breaks the build, and `staticModificationValue` ends in `assertNever`.
 * The arms that actually went unpriced were never in those unions. They were
 * **card fields** — a boolean, an optional clause, a back face — and no
 * exhaustiveness check in TypeScript reaches a field nobody read. `CARD_SHAPES`
 * is the one union in the workspace that names those features, it contains both
 * prior instances of the failure mode, and `faceHasShape` is the single
 * definition of what carries each one. So it is the union with teeth.
 *
 * **Both directions fail.** A shape declared priced whose probe pair scores
 * alike fails, which is the hole. A shape declared unpriced whose pair stops
 * scoring alike also fails, which is the other way a registry rots: somebody
 * prices `costReduction` and this file goes on claiming it is free. Neither
 * verdict is a comment.
 *
 * **What a probe pair is.** Two cards that differ in the one feature
 * `faceHasShape` reads for that shape, and the assertion is on the difference
 * of their scores. Where the feature is the card kind itself the pair cannot be
 * minimal — a creature and an enchantment differ in more than creature-ness —
 * so those arms carry the nearest other kind at the same mana cost and say so.
 * Where the feature is mandatory (every Siege must carry a back face, so no
 * legal battle lacks one) the pair varies the feature instead of removing it,
 * and says so with `variesWithin`.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, CardShape } from '@mtg/dsl';
import { CARD_SHAPES, cardShapes, parseCard } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';

type Verdict =
  /** `evaluateCard`'s score responds to this shape. */
  | { readonly priced: true }
  /** It does not, and this is the sentence that says why that is allowed. */
  | { readonly priced: false; readonly why: string };

type Probe = Verdict & {
  /** A card carrying the shape. */
  readonly w: CardInput;
  /** The nearest card that does not carry it, or — under `variesWithin` — one that carries it differently. */
  readonly wo: CardInput;
  /**
   * Set only where the shape's feature is mandatory on every card that could
   * have it, so `wo` cannot drop it and varies it instead.
   */
  readonly variesWithin?: true;
};

let minted = 0;
function card(over: Record<string, unknown>): CardInput {
  minted += 1;
  return {
    id: `cov-${minted}`,
    name: `Cover ${minted}`,
    rarity: 'common',
    set: { code: 'COV', collectorNumber: minted },
    ...over,
  } as CardInput;
}

/** One mana cost for every green pair, so a kind-vs-kind arm varies only the kind. */
const GREEN = { generic: 1, G: 1 };
/** The four-mana cost the walker and the battle are printed at. */
const GREEN_FOUR = { generic: 3, G: 1 };
const COLORLESS = { generic: 2 };

const bear = (over: Record<string, unknown> = {}): CardInput =>
  card({ kind: 'creature', manaCost: GREEN, colors: ['G'], power: 2, toughness: 2, ...over });
const enchantment = (over: Record<string, unknown> = {}): CardInput =>
  card({ kind: 'enchantment', manaCost: GREEN, colors: ['G'], ...over });
const artifact = (over: Record<string, unknown> = {}): CardInput =>
  card({ kind: 'artifact', manaCost: COLORLESS, colors: [], ...over });
const land = (over: Record<string, unknown> = {}): CardInput =>
  card({ kind: 'land', colors: [], producesMana: ['G'], ...over });
const walker = (over: Record<string, unknown> = {}): CardInput =>
  card({
    kind: 'planeswalker',
    manaCost: GREEN_FOUR,
    colors: ['G'],
    supertypes: ['legendary'],
    subtypes: ['Cover'],
    startingLoyalty: 4,
    ...over,
  });
const siege = (backPower: number): CardInput =>
  card({
    kind: 'battle',
    manaCost: GREEN_FOUR,
    colors: ['G'],
    subtypes: ['Siege'],
    defense: 4,
    backFace: {
      kind: 'creature',
      name: `Cover Back ${backPower}`,
      colors: ['G'],
      subtypes: ['Warrior'],
      power: backPower,
      toughness: backPower,
    },
  });
const instant = (over: Record<string, unknown> = {}): CardInput =>
  card({ kind: 'instant', manaCost: GREEN, colors: ['G'], ...over });
const sorcery = (over: Record<string, unknown> = {}): CardInput =>
  card({ kind: 'sorcery', manaCost: GREEN, colors: ['G'], ...over });

const DRAW = { kind: 'drawCards', count: 3, target: { kind: 'noTarget' } };
const LIFE = { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } };
const KILL = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };

const PROBES: Record<CardShape, Probe> = {
  // The kind arms below are the confounded ones: `wo` is the nearest other kind
  // at the same mana cost, so the delta is the whole difference between two
  // card kinds rather than the price of one word. That is the most a pair can
  // isolate when the feature is `card.kind`.
  creature: { priced: true, w: bear(), wo: enchantment() },
  artifact: {
    priced: true,
    w: artifact(),
    wo: card({ kind: 'enchantment', manaCost: COLORLESS, colors: [] }),
  },
  enchantment: { priced: true, w: enchantment(), wo: bear() },
  planeswalker: {
    priced: true,
    w: walker({ abilities: [] }),
    wo: card({ kind: 'enchantment', manaCost: GREEN_FOUR, colors: ['G'] }),
  },
  battle: {
    priced: true,
    w: siege(4),
    wo: card({ kind: 'enchantment', manaCost: GREEN_FOUR, colors: ['G'] }),
  },
  // A land's branch is empty and every land scores exactly zero. The delta is
  // therefore the spell mana penalty a land does not pay, which is a price: a
  // land and an enchantment at the same cost are not one number.
  land: { priced: true, w: land(), wo: enchantment() },

  artifactCreature: {
    priced: false,
    why:
      'Nothing in the DSL reads artifact-ness. No member of TARGET_KINDS names an artifact, ' +
      'no member of STATIC_SCOPES or EFFECT_SCOPES counts one, and no effect kind destroys one, ' +
      'so an artifact creature is exposed to and enables exactly what any other creature does. ' +
      'The flag exists to fill a generated set’s colorless slot. When a word that reads it ' +
      'lands in the vocabulary, this arm is the one that has to move.',
    w: bear({ artifact: true }),
    wo: bear(),
  },
  aura: {
    priced: true,
    w: enchantment({
      subtypes: ['Aura'],
      aura: { enchant: 'creature', modifications: [{ kind: 'statBonus', power: 2, toughness: 2 }] },
    }),
    wo: enchantment(),
  },
  equipment: {
    priced: true,
    w: artifact({
      subtypes: ['Equipment'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 2 } },
          effects: [],
          attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
        },
      ],
    }),
    wo: artifact(),
  },
  basicLand: {
    priced: false,
    why:
      'Every land scores zero, so no land feature can move the number. That is deliberate rather ' +
      'than missing: which lands a deck plays is mana-base.ts’s decision, taken against the ' +
      'deck’s colors after the spells are picked, and a card score would have no say in it.',
    w: land({ supertypes: ['basic'], basicLandType: 'Forest' }),
    wo: land(),
  },
  // `variesWithin` stays, and for the reason the header gives rather than for
  // the old one: every Siege must carry a back face, so `wo` cannot be a Siege
  // without one and varies the face instead. What moved is the verdict —
  // `battleBackFaceFactor` prices the face by evaluating it, so the 8/8 and
  // the 1/1 are no longer the same number (`battle-back-face.test.ts`).
  doubleFaced: {
    priced: true,
    variesWithin: true,
    w: siege(8),
    wo: siege(1),
  },
  // `instantSpeedPremium`, and the sorcery arm below is the same number read
  // from the other side: the premium is on the instant, so being a sorcery is
  // being the card that does not carry it. `instant-speed.test.ts` pins the
  // size and the derivation.
  instant: {
    priced: true,
    w: instant({ effects: [DRAW] }),
    wo: sorcery({ effects: [DRAW] }),
  },
  sorcery: {
    priced: true,
    w: sorcery({ effects: [DRAW] }),
    wo: instant({ effects: [DRAW] }),
  },
  // Two modes and the better of them printed alone are not the same card, so
  // the pair distinguishes `bestModeValue` from a walk that misses `modes`
  // outright: unread, the modal card would score its empty effect list.
  modal: {
    priced: true,
    w: instant({ modes: [{ effects: [LIFE] }, { effects: [DRAW] }] }),
    wo: instant({ effects: [LIFE] }),
  },
  // The probe carries `opponent` rather than `you` because that is the chooser
  // the shape moves the score for. `may: 'you'` on a beneficial card still
  // scores what the same card without the clause scores, and that is a decision
  // rather than the hole this arm used to declare: you always say yes.
  // `may-chooser.test.ts` holds both halves, which is where a fact keyed by the
  // chooser belongs — this registry is keyed by the shape.
  may: {
    priced: true,
    w: instant({ may: 'opponent', effects: [DRAW] }),
    wo: instant({ effects: [DRAW] }),
  },
  unless: {
    priced: true,
    w: instant({ unless: { payer: 'targetController', cost: { generic: 2 } }, effects: [KILL] }),
    wo: instant({ effects: [KILL] }),
  },
  staticAbility: {
    priced: true,
    w: bear({
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: { kind: 'statBonus', power: 2, toughness: 2 },
        },
      ],
    }),
    wo: bear(),
  },
  triggeredAbility: {
    priced: true,
    w: bear({ abilities: [{ kind: 'triggered', condition: 'selfEnters', effects: [LIFE] }] }),
    wo: bear(),
  },
  activatedAbility: {
    priced: true,
    w: bear({
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
        },
      ],
    }),
    wo: bear(),
  },
  manaAbility: {
    priced: true,
    w: bear({
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true },
          effects: [{ kind: 'addMana', produces: ['G'], amount: 1 }],
        },
      ],
    }),
    wo: bear(),
  },
  loyaltyAbility: {
    priced: true,
    w: walker({
      abilities: [
        {
          kind: 'activated',
          loyaltyCost: 2,
          cost: { mana: {} },
          effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }],
        },
      ],
    }),
    wo: walker({ abilities: [] }),
  },
  keywordAbility: { priced: true, w: bear({ keywordAbilities: [{ kind: 'indestructible' }] }), wo: bear() },
  keyword: { priced: true, w: bear({ keywords: ['flying'] }), wo: bear() },
  tokenMaker: {
    priced: true,
    w: sorcery({
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: { name: 'Cover Beast', power: 2, toughness: 2, colors: ['G'], subtypes: ['Beast'] },
        },
      ],
    }),
    wo: sorcery({ effects: [LIFE] }),
  },
  flavorText: {
    priced: false,
    why: 'It has no rules meaning. This is the one arm that should never move.',
    w: bear({ flavorText: 'It shapes the world.' }),
    wo: bear(),
  },
  costReduction: {
    priced: true,
    w: bear({ costReduction: { amount: 3, cardType: 'creature' } }),
    wo: bear(),
  },
  // The shape is named for `entersTapped` but reads the whole entry-replacement
  // union, so the pair uses the arm where the gap was widest: two +1/+1 counters
  // make a 2/2 for two mana into a 4/4 for two mana. `entryReplacementValue`
  // prices every arm of that union, and `entry-replacement-value.test.ts` is
  // where each arm's own number is pinned (mtg-pr8a).
  entersTapped: {
    priced: true,
    w: bear({ entryReplacement: { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 2 } }),
    wo: bear(),
  },
};

/** Float noise from summing a dozen components is not a price. */
const NOISE = 1e-9;

function score(input: CardInput): number {
  return evaluateCard(parseCard(input), DEFAULT_SCORE_WEIGHTS).score;
}

describe('every card shape is priced or declared unpriced', () => {
  it('covers the union exactly, with nothing left over', () => {
    expect(Object.keys(PROBES).sort()).toEqual([...CARD_SHAPES].sort());
  });

  for (const shape of CARD_SHAPES) {
    const probe = PROBES[shape];

    it(`${shape}: the pair differs in ${shape} and nothing the verdict does not account for`, () => {
      expect(cardShapes(parseCard(probe.w))).toContain(shape);
      if (probe.variesWithin === true) {
        expect(cardShapes(parseCard(probe.wo))).toContain(shape);
      } else {
        expect(cardShapes(parseCard(probe.wo))).not.toContain(shape);
      }
    });

    it(`${shape}: ${probe.priced ? 'moves the score' : 'is declared unpriced and moves nothing'}`, () => {
      const delta = score(probe.w) - score(probe.wo);
      if (probe.priced) {
        expect(Math.abs(delta)).toBeGreaterThan(NOISE);
      } else {
        expect(probe.why.length).toBeGreaterThan(40);
        expect(Math.abs(delta)).toBeLessThan(NOISE);
      }
    });
  }
});
