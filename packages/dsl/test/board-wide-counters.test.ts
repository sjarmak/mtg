/**
 * `putCounters` aimed at nobody, reading a region of the board.
 *
 * Until `mtg-hfex` this primitive named a permanent, a player whose creatures a
 * scope then read, or its own source, and nothing else. That left one printed
 * shape unwritable: "{T}: Put a +1/+1 counter on each artifact creature you
 * control" (Steel Overseer, M11 214) chooses nothing (CR 115.1) and reads a
 * region of the board, which needs a `noTarget` slot beside a space scope, and
 * the row admitted neither.
 *
 * Two widenings, and the second one is why the first is not enough on its own.
 * `noTarget` says the card chooses nobody; `permanentsYouControl` says which
 * region; and the `scopeFilter` says which bodies in it, which the space scopes
 * have always needed because the region word names no card type — the same pair
 * `destroyPermanent` writes for Day of Judgment and `pumpUntilEndOfTurn` writes
 * for Glorious Charge. `putCounters` carried the scope half of `SWEEP_FIELD`
 * and not the filter half, so it now takes the pair whole.
 *
 * **The containment invariant is what this file mostly guards.** `putCounters`
 * is expressible by hand and unreachable from the generator, and the widening
 * has to leave that exactly where it was. Three independent statements below say
 * so: the kind is absent from every model-facing effect union, `noTarget` and
 * the defending-player kind land in `HAND_AUTHORED_TARGETS` rather than in the
 * generatable list the fill prompt prints verbatim, and every (kind, target)
 * pair the model can name is still inside `MODEL_TARGET_KINDS`.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput, TargetKind } from '../src/index';
import {
  HAND_AUTHORED_TARGETS,
  LEGAL_TARGETS,
  MODEL_EFFECT_KINDS,
  MODEL_TARGET_KINDS,
  legalTargetsFor,
  renderOracleText,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';
import {
  ModelEffectSchema,
  PartBearingModelEffectSchema,
  ZoneReachingModelEffectSchema,
} from '../src/effects';

const NO_TARGET: TargetKind = 'noTarget';
const DEFENDER_TARGET: TargetKind = 'targetCreatureDefendingPlayerControls';

/** Steel Overseer's line, as near as this vocabulary prints it. */
const OVERSEER_PUMP: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 0 }, tapSelf: true },
  effects: [
    {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 1,
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['artifact'] },
      target: { kind: NO_TARGET },
    },
  ],
};

function artifactInput(abilities: readonly AbilityInput[]): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'xmp-board-counter-probe',
    name: 'Forge Overseer',
    rarity: 'rare',
    set: { code: 'XMP', collectorNumber: 310 },
    manaCost: { generic: 2 },
    colors: [],
    supertypes: [],
    subtypes: ['Construct'],
    keywords: [],
    artifact: true,
    power: 1,
    toughness: 1,
    abilities: [...abilities],
  };
}

/** `parseCard` throws on a violation, so a refusal is asserted off the record. */
function unparsed(input: Record<string, unknown>): Card {
  return input as unknown as Card;
}

function codesFor(input: Record<string, unknown>): readonly string[] {
  return validateCard(unparsed(input)).map((found) => found.code);
}

describe('a counter placement that reads a region of the board', () => {
  it('validates and prints the distributive singular Magic prints', () => {
    const card = parseCard(artifactInput([OVERSEER_PUMP]) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('{T}: Put a +1/+1 counter on each artifact you control.');
  });

  it('takes the filter through to the printed line rather than dropping it', () => {
    const card = parseCard(
      artifactInput([
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            {
              kind: 'putCounters',
              counter: 'gloom',
              count: 1,
              scope: 'permanentsYouControl',
              scopeFilter: { cardTypes: ['creature'] },
              target: { kind: NO_TARGET },
            },
          ],
        },
      ]) as CardInput,
    );
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain(
      'put a gloom counter on each creature you control. (A creature with a gloom counter gets -1/-1.)',
    );
  });

  /**
   * The pairing `checkSpaceScope` exists to refuse: a region word names no card
   * type, so a sweep without a filter is "put a counter on each you control" —
   * a sentence that would put a +1/+1 counter on every land the caster has.
   */
  it('is refused with a scope and no filter saying which permanents', () => {
    expect(
      codesFor(
        artifactInput([
          {
            kind: 'activated',
            cost: { mana: { generic: 0 }, tapSelf: true },
            effects: [
              {
                kind: 'putCounters',
                counter: 'plusOnePlusOne',
                count: 1,
                scope: 'permanentsYouControl',
                target: { kind: NO_TARGET },
              },
            ],
          },
        ]),
      ),
    ).toEqual(['ILLEGAL_EFFECT_SCOPE']);
  });

  /** The mirror refusal: a card that chooses nothing and names no group either. */
  it('is refused with no target and no scope, which reaches no object at all', () => {
    expect(
      codesFor(
        artifactInput([
          {
            kind: 'activated',
            cost: { mana: { generic: 0 }, tapSelf: true },
            effects: [
              { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: NO_TARGET } },
            ],
          },
        ]),
      ),
    ).toEqual(['ILLEGAL_EFFECT_SCOPE']);
  });

  /** A space scope chooses nothing, so a slot beside it is a choice nobody reads. */
  it('is refused with a space scope and a target slot both', () => {
    expect(
      codesFor(
        artifactInput([
          {
            kind: 'activated',
            cost: { mana: { generic: 0 }, tapSelf: true },
            effects: [
              {
                kind: 'putCounters',
                counter: 'plusOnePlusOne',
                count: 1,
                scope: 'permanentsYouControl',
                scopeFilter: { cardTypes: ['artifact'] },
                target: { kind: 'targetCreature' },
              },
            ],
          },
        ]),
      ),
    ).toEqual(['ILLEGAL_EFFECT_SCOPE']);
  });

  /**
   * The hole the widened schema could have opened, and does not. `putCounters`
   * now carries `scopeFilter`, so the two shapes that field must never take are
   * asserted here rather than assumed: the player-reading scope already names
   * its objects ("each creature that player controls"), so a filter beside it
   * is a second answer to one question, and an unscoped placement names one
   * permanent, so there is no group for a filter to narrow. Both refusals are
   * `checkEffectScope`'s generic rules, which is why the widening needed no
   * rule of its own.
   */
  it('refuses the filter beside a scope that already names its objects', () => {
    expect(
      codesFor(
        artifactInput([
          {
            kind: 'triggered',
            condition: 'selfEnters',
            effects: [
              {
                kind: 'putCounters',
                counter: 'gloom',
                count: 1,
                scope: 'creaturesThatPlayerControls',
                scopeFilter: { cardTypes: ['creature'] },
                target: { kind: 'targetOpponent' },
              },
            ],
          },
        ]),
      ),
    ).toEqual(['ILLEGAL_EFFECT_SCOPE']);
  });

  it('refuses a filter with no scope at all, which narrows nothing', () => {
    expect(
      codesFor(
        artifactInput([
          {
            kind: 'activated',
            cost: { mana: { generic: 0 }, tapSelf: true },
            effects: [
              {
                kind: 'putCounters',
                counter: 'plusOnePlusOne',
                count: 1,
                scopeFilter: { cardTypes: ['artifact'] },
                target: { kind: 'targetCreature' },
              },
            ],
          },
        ]),
      ),
    ).toEqual(['ILLEGAL_EFFECT_SCOPE']);
  });

  /**
   * The other side of the board stays unreachable, and that is a census answer
   * rather than a rules one: nothing in the M11/M13 population puts a counter
   * on a whole board or on an opponent's half of it, so those two scopes wait
   * for the card that asks.
   */
  it('reaches neither the whole board nor the other side of it', () => {
    for (const scope of ['allPermanents', 'permanentsOpponentsControl'] as const) {
      expect(
        codesFor(
          artifactInput([
            {
              kind: 'activated',
              cost: { mana: { generic: 0 }, tapSelf: true },
              effects: [
                {
                  kind: 'putCounters',
                  counter: 'plusOnePlusOne',
                  count: 1,
                  scope,
                  scopeFilter: { cardTypes: ['creature'] },
                  target: { kind: NO_TARGET },
                },
              ],
            },
          ]),
        ),
        scope,
      ).toEqual(['ILLEGAL_EFFECT_SCOPE']);
    }
  });

  /**
   * A counter is something a permanent on the battlefield carries (CR 611.2c),
   * so the hand and graveyard scopes stay refused for the reason they always
   * were: there is nowhere on those cards for a counter to be.
   */
  it('still reaches no zone the battlefield is not', () => {
    for (const scope of ['creatureCardsInPlayerHand', 'creatureCardsInPlayerGraveyard'] as const) {
      expect(
        codesFor(
          artifactInput([
            {
              kind: 'triggered',
              condition: 'selfEnters',
              effects: [
                {
                  kind: 'putCounters',
                  counter: 'plusOnePlusOne',
                  count: 1,
                  scope,
                  target: { kind: 'targetOpponent' },
                },
              ],
            },
          ]),
        ),
        scope,
      ).toContain('ILLEGAL_EFFECT_SCOPE');
    }
  });
});

describe('the attack trigger that shrinks a would-be blocker', () => {
  const REAPER: AbilityInput = {
    kind: 'triggered',
    condition: 'selfAttacks',
    effects: [
      { kind: 'putCounters', counter: 'minusOneMinusOne', count: 1, target: { kind: DEFENDER_TARGET } },
    ],
  };

  it('validates and prints the printed template', () => {
    const card = parseCard(artifactInput([REAPER]) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Whenever Forge Overseer attacks, put a -1/-1 counter on target creature defending player controls.',
    );
  });

  /**
   * The `selfAttacks` gate is generic and was already enforced, so this row
   * needed no rule of its own — which is the whole reason the widening is one
   * table entry. Both refusals below come from `ATTACK_TRIGGER_ONLY_TARGETS`.
   */
  it('is refused on any other trigger and on an activated ability', () => {
    expect(codesFor(artifactInput([{ ...REAPER, condition: 'selfEnters' } as AbilityInput]))).toContain(
      'ILLEGAL_TARGET_IN_ABILITY',
    );
    expect(
      codesFor(
        artifactInput([
          {
            kind: 'activated',
            cost: { mana: { generic: 1 }, tapSelf: true },
            effects: REAPER.effects,
          } as AbilityInput,
        ]),
      ),
    ).toContain('ILLEGAL_TARGET_IN_ABILITY');
  });
});

describe('the containment invariant, restated over the two widened kinds', () => {
  /**
   * The strongest of the three statements, and the one that makes the other two
   * belt and braces: `putCounters` is not a member of any union the model is
   * shown, so no widening of its targeting can reach the generator at all.
   */
  it('keeps putCounters out of every model-facing effect union', () => {
    for (const union of [ModelEffectSchema, PartBearingModelEffectSchema, ZoneReachingModelEffectSchema]) {
      expect(union.options.map((option) => option.shape.kind.value)).not.toContain('putCounters');
    }
    expect(MODEL_EFFECT_KINDS).not.toContain('putCounters');
  });

  it('lands both kinds in the hand-authored half, leaving the printed list alone', () => {
    expect(HAND_AUTHORED_TARGETS['putCounters']).toContain(NO_TARGET);
    expect(HAND_AUTHORED_TARGETS['putCounters']).toContain(DEFENDER_TARGET);
    // The generatable half is what the fill prompt prints verbatim and what
    // every recorded fixture is keyed to, and it is byte-identical.
    expect(LEGAL_TARGETS.putCounters).toEqual(['targetCreature', 'targetCreatureYouControl']);
    expect(legalTargetsFor('putCounters')).toContain(NO_TARGET);
  });

  it('leaves every pair the model can name inside the four frozen kinds', () => {
    expect([...MODEL_TARGET_KINDS]).toEqual(['anyTarget', 'targetCreature', 'targetPlayer', 'noTarget']);
    for (const kind of MODEL_EFFECT_KINDS) {
      for (const target of LEGAL_TARGETS[kind]) {
        expect(MODEL_TARGET_KINDS, `${kind}/${target}`).toContain(target);
      }
    }
  });
});
