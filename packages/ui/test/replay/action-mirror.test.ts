/**
 * The replay log's action schema against the kernel's own `Action`, field by
 * field.
 *
 * `record.test.ts` already asserts the two agree about which action *types*
 * exist (`MutuallyAssignable<ActionType, LogAction['type']>`), and that check is
 * blind to the thing that broke: `activateAbility` grew a required `sacrifices`
 * field in `@mtg/kernel`, `log-schema.ts` kept the five fields it had, and every
 * `strictObject` parse of an activation began throwing `unrecognized_keys`.
 * Nothing went red, because the two pinned fixture games are RW-versus-UB
 * creature decks that never activate anything.
 *
 * Three assertions the type-name check does not make:
 *
 *  1. **Fields, not just names.** `ActionFields` maps each action type to the
 *     union of its keys, on both sides, and the two maps must be mutually
 *     assignable. A field added to a kernel action and not to the schema fails
 *     `npm run typecheck` at the declaration below, before any game is played.
 *  2. **Required, not merely present.** The same map carries each variant's
 *     required keys beside its keys, because `keyof` counts an optional key and
 *     a required one alike: `sacrifices` relaxed to `.optional()` in the schema
 *     is drift that keeps every key it had, and the field's own docblock says it
 *     is required so the log has one spelling of "sacrificed nothing".
 *  3. **A game that actually activates.** The type check is compile-time and
 *     says nothing about what zod accepts at runtime, so a recorded game over a
 *     deck of activated abilities parses one for real. This deck is deliberately
 *     not a third fixture game: the committed fixture is a byte-for-byte
 *     contract, and proving a parse does not need a hundred kilobytes of
 *     committed board snapshots.
 *
 * What the recorded game does *not* cover is the element type: `ActionFields`
 * compares key names and not what they hold, and the bots' activations all carry
 * `sacrifices: []`, which parses under any element schema. `sacrifices` declared
 * as an array of numbers is caught by the hand-written activation in the last
 * test and by nothing else here, which is why that test spells two object ids
 * out rather than trusting a game to produce some.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, MutuallyAssignable } from '@mtg/dsl';
import { BASIC_LANDS, mana, parseCard } from '@mtg/dsl';
import type { Action, DeckList } from '@mtg/kernel';
import { greedyBot } from '@mtg/sim';
import {
  ActionSchema,
  EVENT_LOG_SCHEMA_VERSION,
  EventSchema,
  HeaderRecordSchema,
  StackEntrySchema,
} from '../../src/routes/replay/log-schema';
import type { LogAction } from '../../src/routes/replay/log-schema';
import { recordGame } from '../../tools/record-replay';

/**
 * The keys a type cannot be constructed without.
 *
 * `keyof` counts an optional key exactly as it counts a required one, so a
 * schema that relaxes `sacrifices: z.array(...)` to `.optional()` keeps every
 * key it had and drifts anyway — the recorder starts accepting a log the field
 * is missing from, which is the shape the field's own docblock exists to
 * forbid. `Partial<Pick<T, K>>` is the same key made optional, and it is
 * assignable back to `Pick<T, K>` only when the key already was.
 */
type RequiredKeys<T> = {
  readonly [K in keyof T]-?: Partial<Pick<T, K>> extends Pick<T, K> ? never : K;
}[keyof T];

/**
 * Every key of every member of an action union, keyed by the discriminant, and
 * separately the ones that are required.
 *
 * A mapped type over `A['type']` rather than a union of `keyof`s, because a
 * union hides two different drifts: `keyof (X | Y)` is only the *shared* keys,
 * and a flat union of all keys would stay satisfied while a field moved from one
 * action to another.
 *
 * `required` is the third drift, and it is the one `keyof` alone is blind to.
 * The two halves are separate members rather than one set of required keys,
 * because a field the kernel made optional and the schema still requires is
 * also drift, and `required` alone would call that agreement.
 */
type ActionFields<A extends { readonly type: string }> = {
  readonly [T in A['type']]: {
    readonly all: keyof Extract<A, { readonly type: T }>;
    readonly required: RequiredKeys<Extract<A, { readonly type: T }>>;
  };
};

const actionFieldsCovered: MutuallyAssignable<ActionFields<Action>, ActionFields<LogAction>> = true;

function basicMountain(): Card {
  const found = BASIC_LANDS.find((card) => card.name === 'Mountain');
  if (found === undefined) throw new Error('the DSL ships no Mountain');
  return found;
}

const MOUNTAIN: Card = basicMountain();

/** `{1}, {T}: CARDNAME deals 1 damage to any target.` */
const PING: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: true },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
};

function beacon(collectorNumber: number): Card {
  return parseCard({
    kind: 'artifact',
    id: `replay-beacon-${collectorNumber}`,
    name: 'Replay Beacon',
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: mana({ generic: 2 }),
    abilities: [PING],
  });
}

/** Twenty-three pingers and seventeen Mountains: the bots activate every turn. */
function beaconDeck(name: string, collectorNumber: number): DeckList {
  const card = beacon(collectorNumber);
  return {
    name,
    cards: [...Array.from({ length: 23 }, () => card), ...Array.from({ length: 17 }, () => MOUNTAIN)],
  };
}

/** Every action the recorded log carries, chosen or merely offered. */
function recordedActions(): readonly LogAction[] {
  const recorded = recordGame({
    index: 0,
    seed: 'replay/activation-mirror/1',
    decks: [beaconDeck('Beacons A', 1), beaconDeck('Beacons B', 2)],
    agents: [greedyBot('greedy-a'), greedyBot('greedy-b')],
    startingPlayer: 0,
    maximumTurns: 12,
  });
  const actions: LogAction[] = [];
  for (const step of recorded.steps) {
    if (step.action !== null) actions.push(step.action);
    if (step.decision !== null) actions.push(...step.decision.options);
  }
  return actions;
}

describe('the log schema mirrors the kernel action', () => {
  it('carries the same fields on the same action types', () => {
    expect(actionFieldsCovered).toBe(true);
  });

  it('records a game whose bots pay for an activated ability', () => {
    const activations = recordedActions().filter((action) => action.type === 'activateAbility');
    expect(activations.length).toBeGreaterThan(0);
  });

  it('accepts an activation that names the permanents its cost eats', () => {
    const paid = ActionSchema.parse({
      type: 'activateAbility',
      player: 0,
      oid: 'o1',
      abilityIndex: 0,
      targets: [null],
      sacrifices: ['o2', 'o3'],
    });
    expect(paid).toEqual({
      type: 'activateAbility',
      player: 0,
      oid: 'o1',
      abilityIndex: 0,
      targets: [null],
      sacrifices: ['o2', 'o3'],
    });
  });

  it('retains X and copied-spell identity in a stack snapshot', () => {
    expect(
      StackEntrySchema.parse({
        oid: 'cp1',
        controller: 0,
        card: 'o1',
        source: null,
        copiedFrom: 'o1',
        chosenX: 3,
        triggerContext: null,
        sourceCharacteristics: null,
        targets: [{ kind: 'player', player: 1 }],
      }),
    ).toEqual({
      oid: 'cp1',
      controller: 0,
      card: 'o1',
      source: null,
      copiedFrom: 'o1',
      chosenX: 3,
      // Omitted on input, the way a pre-`mtg-7si0` record would be: `.default(null)`
      // backfills it rather than requiring every already-recorded stack entry to
      // carry the key (`log-schema.ts` says why this field skips the usual
      // version-bump-plus-required-field treatment).
      mode: null,
      triggerContext: null,
      sourceCharacteristics: null,
      targets: [{ kind: 'player', player: 1 }],
    });
  });

  it('retains a trigger referent outside the chosen-target tuple', () => {
    expect(
      StackEntrySchema.parse({
        oid: 'ab1',
        controller: 0,
        card: 'o1',
        source: 'o1',
        copiedFrom: null,
        chosenX: null,
        triggerContext: {
          kind: 'controlledCreatureAttacksAlone',
          triggeringCreature: 'o2',
        },
        sourceCharacteristics: null,
        targets: [],
      }),
    ).toEqual(
      expect.objectContaining({
        triggerContext: {
          kind: 'controlledCreatureAttacksAlone',
          triggeringCreature: 'o2',
        },
        targets: [],
      }),
    );
  });

  it('preserves a tagged planeswalker defender in actions and events', () => {
    const defender = { kind: 'planeswalker' as const, oid: 'walker-1' };
    expect(
      ActionSchema.parse({
        type: 'declareAttackers',
        player: 0,
        attackers: [{ oid: 'attacker-1', defender }],
      }),
    ).toEqual({
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: 'attacker-1', defender }],
    });
    expect(
      EventSchema.parse({
        type: 'attackersDeclared',
        player: 0,
        attacks: [{ oid: 'attacker-1', defender }],
      }),
    ).toEqual({
      type: 'attackersDeclared',
      player: 0,
      attacks: [{ oid: 'attacker-1', defender }],
    });
  });

  it('rejects an untagged object defender in actions and events', () => {
    expect(() =>
      ActionSchema.parse({
        type: 'declareAttackers',
        player: 0,
        attackers: [{ oid: 'attacker-1', defender: { oid: 'walker-1' } }],
      }),
    ).toThrow();
    expect(() =>
      EventSchema.parse({
        type: 'attackersDeclared',
        player: 0,
        attacks: [{ oid: 'attacker-1', defender: { oid: 'walker-1' } }],
      }),
    ).toThrow();
  });

  it('identifies new tagged-defender logs while retaining legacy numeric-defender headers', () => {
    expect(EVENT_LOG_SCHEMA_VERSION).toBe('mtg-ui/event-log/8');
    expect(
      HeaderRecordSchema.parse({
        record: 'header',
        schema: 'mtg-ui/event-log/3',
        source: 'legacy fixture',
        games: 1,
      }).schema,
    ).toBe('mtg-ui/event-log/3');
  });
});
