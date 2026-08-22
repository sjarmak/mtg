/**
 * Indestructible and hexproof on a noncreature permanent (`mtg-rji`).
 *
 * The kernel side of this was never creature-gated: `destroyPermanent` returns
 * the trace unchanged the moment `hasKeywordAbility(state, oid,
 * 'indestructible')` answers yes, `sba.ts`'s CR 704 sweep asks the same
 * question of anything it is about to doom, and `canBeTargetedBy` reads
 * hexproof off whatever object a spell is being aimed at. Only
 * `@mtg/dsl`'s `checkKeywords` refused to let a card say either word unless it
 * was a creature, so the clause was unreachable rather than unimplemented.
 *
 * This file is the proof that the engine half needs no work — it pins the
 * behavior for an artifact so a later creature-shaped shortcut in the kernel
 * fails here rather than in a game of the flagship set. Three claims:
 *
 * 1. CR 702.12a: an indestructible artifact survives a `destroyPermanent`.
 * 2. CR 701.17a is a different action from CR 701.7: indestructible does not
 *    stop a sacrifice, and the same artifact reaches its owner's graveyard the
 *    moment it pays its own activation cost with itself.
 * 3. CR 702.11b: a hexproof artifact is not among the targets an opponent's
 *    spell may choose, and is still among its own controller's.
 *
 * The negative control in each case is a second, plain artifact on the same
 * board — a test with one permanent would pass on a kernel that had stopped
 * destroying anything at all.
 */
import { parseCard, type Card } from '@mtg/dsl';
import type { Action, GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  destroyPermanent,
  eventsOfType,
  legalActions,
  scenario,
  targetChoicesFor,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { instant, MOUNTAIN } from './cards';
import { apply, oidOf } from './helpers';

/** `{3}` Legendary Artifact, indestructible — the playtester's Trisigil, minus its cycle. */
const TRISIGIL: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-trisigil',
  name: 'The Trisigil',
  rarity: 'mythic',
  set: { code: 'XMP', collectorNumber: 1 },
  manaCost: { generic: 3 },
  supertypes: ['legendary'],
  keywordAbilities: [{ kind: 'indestructible' }],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, sacrificeSelf: true },
      effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
    },
  ],
});

const WARDED_RELIC: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-warded-relic',
  name: 'Warded Relic',
  rarity: 'rare',
  set: { code: 'XMP', collectorNumber: 2 },
  manaCost: { generic: 2 },
  keywordAbilities: [{ kind: 'hexproof' }],
});

const PLAIN_RELIC: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-plain-relic',
  name: 'Plain Relic',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 3 },
  manaCost: { generic: 2 },
});

const SUNDER = instant(
  'Sunder',
  [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } }],
  { generic: 1, R: 1 },
);

function permanent(state: GameState, name: string): { kind: 'permanent'; oid: ObjectId } {
  return { kind: 'permanent', oid: oidOf(state, name) };
}

function activationOf(state: GameState, oid: ObjectId): Action {
  const option = legalActions(state).find((entry) => entry.type === 'activateAbility' && entry.oid === oid);
  if (option === undefined) throw new Error(`no activated ability offered for ${oid}`);
  return option;
}

describe('indestructible on a noncreature permanent', () => {
  it('survives a destroy that takes the plain artifact beside it', () => {
    const start: ReduceResult = scenario({
      battlefield: [
        { card: TRISIGIL, controller: 0 },
        { card: PLAIN_RELIC, controller: 0 },
      ],
    });
    const trisigil = oidOf(start.state, 'The Trisigil');
    const plain = oidOf(start.state, 'Plain Relic');

    const swept = destroyPermanent(
      destroyPermanent(beginTrace(start.state), trisigil, 'destroyEffect'),
      plain,
      'destroyEffect',
    );

    expect(swept.state.objects[trisigil]?.zone).toBe('battlefield');
    expect(swept.state.objects[plain]?.zone).toBe('graveyard');
    expect(eventsOfType(swept.events, 'permanentDestroyed').map((event) => event.oid)).toEqual([plain]);
  });

  it('does not stop a sacrifice, which is a cost and not a destruction', () => {
    const start = scenario({
      battlefield: [
        { card: TRISIGIL, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
    });
    const trisigil = oidOf(start.state, 'The Trisigil');

    const activated = apply(start, activationOf(start.state, trisigil));

    expect(activated.state.objects[trisigil]?.zone).toBe('graveyard');
    expect(activated.state.players[0].graveyard).toContain(trisigil);
    expect(eventsOfType(activated.events, 'permanentDestroyed')).toHaveLength(0);
  });
});

describe('hexproof on a noncreature permanent', () => {
  it('is refused to an opponent aiming a spell and offered to its own controller', () => {
    const board = [
      { card: WARDED_RELIC, controller: 0 as const },
      { card: PLAIN_RELIC, controller: 0 as const },
    ];
    const opposing = scenario({
      battlefield: [...board, { card: MOUNTAIN, controller: 1 }],
      hands: [[], [SUNDER]],
    });
    expect(targetChoicesFor(opposing.state, SUNDER, 1)).toEqual([[permanent(opposing.state, 'Plain Relic')]]);

    const own = scenario({
      battlefield: [...board, { card: MOUNTAIN, controller: 0 }],
      hands: [[SUNDER], []],
    });
    expect(targetChoicesFor(own.state, SUNDER, 0)).toEqual([
      [permanent(own.state, 'Warded Relic'), permanent(own.state, 'Plain Relic')],
    ]);
  });
});
