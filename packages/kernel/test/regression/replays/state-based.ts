/**
 * State-based-action defects the bank replays.
 *
 * Three entries, and they are three different shapes CR 704 takes in this
 * kernel: a sweep that had to stop and ask (`d1c57f6`, CR 704.5j), a sweep that
 * had to happen one step after the zone change it follows rather than instead
 * of it (`6452a17`, CR 111.7 and CR 704.5d), and a sweep whose verdict had to
 * read the whole table rather than the first loser (`0b2e140`, CR 104.4b).
 *
 * The fuller treatments live in `legend-rule.test.ts`, `token-death.test.ts`
 * and `sba.test.ts`. What is here is the one property each fix produced, stated
 * so that reintroducing the pre-fix line turns it red.
 */
import { expect } from 'vitest';
import type { Card, TokenSpec } from '@mtg/dsl';
import { colorsFromCost, mana, parseCard } from '@mtg/dsl';
import type { Action, DamageInstance, GameState, ObjectId, PlayerId, ReduceResult } from '@mtg/kernel';
import {
  applyDamage,
  beginTrace,
  checkStateBasedActions,
  eventsOfType,
  getObject,
  isDraw,
  pendingDecision,
  scenario,
} from '@mtg/kernel';
import { instant, MOUNTAIN, sorcery } from '../../cards';
import { apply, handOidOf, oidOf, oidsOf } from '../../helpers';
import { replay } from '../bank';

function legendaryLink(): Card {
  const cost = mana({ generic: 1 });
  return parseCard({
    kind: 'creature',
    id: 'rgn-link-1',
    name: 'Kaelen',
    rarity: 'rare',
    set: { code: 'RGN', collectorNumber: 1 },
    manaCost: cost,
    colors: colorsFromCost(cost),
    supertypes: ['legendary'],
    power: 2,
    toughness: 2,
  });
}

/** A 1/1 Monster token that pays its killer three life when it dies. */
const BRIGAND: TokenSpec = {
  name: 'Brigand',
  power: 1,
  toughness: 1,
  colors: ['R'],
  subtypes: ['Brigand', 'Monster'],
  keywords: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
    },
  ],
};

const BLOOD_MOON = sorcery('Blood Moon Rises', [{ kind: 'createToken', count: 1, token: BRIGAND }], {
  generic: 1,
  R: 1,
});

const ANCIENT_BLADE = instant('Ancient Blade', [
  { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
]);

const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function settle(from: ReduceResult): ReduceResult {
  let current = from;
  for (const action of PASS) current = apply(current, action);
  return current;
}

function tokenOid(state: GameState): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.token === true);
  if (found === undefined) throw new Error('no token on the battlefield');
  return found;
}

function graveyardNames(state: GameState, player: PlayerId): readonly string[] {
  const seat = state.players[player];
  if (seat === undefined) throw new Error(`no seat ${player}`);
  return seat.graveyard.map((oid) => state.objects[oid]?.card.name ?? '?');
}

function lifeOf(state: GameState, player: PlayerId): number {
  const seat = state.players[player];
  if (seat === undefined) throw new Error(`no seat ${player}`);
  return seat.life;
}

function burn(sourceOid: ObjectId, player: PlayerId, amount: number): DamageInstance {
  return {
    sourceOid,
    controller: 0,
    recipient: { kind: 'player', player },
    amount,
    deathtouch: false,
    lifelink: false,
    combat: false,
  };
}

/** One simultaneous batch of damage, then the sweep that reads it. */
function damageThenCheck(from: ReduceResult, instances: readonly DamageInstance[]): ReduceResult {
  const checked = checkStateBasedActions(applyDamage(beginTrace(from.state), instances));
  return { state: checked.state, events: checked.events };
}

/** Six Mountains, a token-maker and a removal spell in hand. */
function redBoard(): ReduceResult {
  return scenario({
    battlefield: Array.from({ length: 6 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    hands: [[BLOOD_MOON, ANCIENT_BLADE], []],
  });
}

export const STATE_BASED_REPLAYS = [
  replay(
    '6452a17',
    'CR 111.7 then CR 704.5d: a dying token reaches a graveyard, fires its death trigger, and only then stops existing',
    () => {
      const start = redBoard();
      const summoned = settle(
        apply(start, {
          type: 'castSpell',
          player: 0,
          oid: handOidOf(start.state, 0, 'Blood Moon Rises'),
          targets: [null],
        }),
      );
      const token = tokenOid(summoned.state);
      const before = lifeOf(summoned.state, 0);

      const killed = settle(
        apply(summoned, {
          type: 'castSpell',
          player: 0,
          oid: handOidOf(summoned.state, 0, 'Ancient Blade'),
          targets: [{ kind: 'permanent', oid: token }],
        }),
      );
      const dead = settle(killed);

      // The trigger fired. Asserted as a movement rather than as a total, so
      // what is measured is the token's own printed gain and not a number
      // copied out of the fixture beside it.
      expect(lifeOf(dead.state, 0), 'the dying token fired no death trigger').toBeGreaterThan(before);
      // And it fired because of a real zone change into a graveyard, in the
      // order CR 111.7 has it, rather than out of a token-shaped special case.
      // The pre-fix `moveObject` sent a leaving token straight to exile in one
      // line, so this list was a single battlefield->exile entry.
      const moved = eventsOfType(dead.events, 'zoneChanged').filter((event) => event.oid === token);
      expect(moved.map((event) => `${event.from}->${event.to}`)).toEqual([
        'battlefield->graveyard',
        'graveyard->exile',
      ]);
      // CR 704.5d, the half that keeps the graveyard honest: once the sweep has
      // run, nothing finds the token there.
      expect(graveyardNames(dead.state, 0)).not.toContain('Brigand');
      expect(getObject(dead.state, token).zone).toBe('exile');
    },
  ),
  replay(
    'd1c57f6',
    'CR 704.5j: the legend rule asks the controller of the copies which one survives, and keeps the one it is told',
    () => {
      const link = legendaryLink();
      const start = scenario({
        battlefield: [
          { card: link, controller: 0, damage: 1 },
          { card: link, controller: 0 },
        ],
      });

      // The question is raised, addressed to the controller of the collision,
      // and nothing is buried while it stands open. The pre-fix sweep decided
      // for the player on a fixed tiebreak over entry order, which is a legal
      // board reached through a decision nobody made.
      const asked = pendingDecision(start.state);
      if (asked === null || asked.kind !== 'legendRule') {
        throw new Error(`expected a legend rule question, got ${asked?.kind ?? 'nothing'}`);
      }
      expect(asked.player).toBe(0);
      expect(oidsOf(start.state, 'Kaelen')).toHaveLength(2);
      expect(graveyardNames(start.state, 0)).toEqual([]);

      // And the answer is honored whichever copy it names. The undamaged second
      // copy is the load-bearing pick: entry order would have kept the first,
      // so a sweep that picked for the player cannot pass this line.
      const second = oidsOf(start.state, 'Kaelen')[1];
      if (second === undefined) throw new Error('both Links should be alive');
      const done = apply(start, { type: 'keepLegend', player: asked.player, oid: second });

      expect(done.state.battlefield).toContain(second);
      expect(oidsOf(done.state, 'Kaelen').filter((oid) => done.state.battlefield.includes(oid))).toEqual([
        second,
      ]);
      expect(graveyardNames(done.state, 0)).toEqual(['Kaelen']);
      // CR 704.5j *puts* the losers into the graveyard rather than destroying
      // them, so nothing reports a destruction.
      expect(eventsOfType(done.events, 'permanentDestroyed')).toEqual([]);
    },
  ),
  replay(
    '0b2e140',
    'CR 104.4b: every player still in the game losing at once is a draw, not a win for the seat that also died',
    () => {
      const start = scenario({
        battlefield: [{ card: MOUNTAIN, controller: 0 }],
        life: [2, 2],
      });
      const source = oidOf(start.state, 'Mountain');
      const both = damageThenCheck(start, [burn(source, 0, 2), burn(source, 1, 2)]);

      const drawn = both.state.result;
      if (drawn === null) throw new Error('the symmetric batch did not end the game');
      expect(isDraw(drawn), 'a simultaneous loss scored a winner').toBe(true);
      expect(drawn.winner).toBeNull();
      expect(drawn.loser).toBeNull();
      expect(both.state.players.map((seat) => seat.lost)).toEqual([true, true]);
      expect(eventsOfType(both.events, 'playerLost').map((event) => event.player)).toEqual([0, 1]);

      // Non-vacuity from the other side: the same batch lethal to one seat only
      // still awards the win, so the rule reads the table rather than answering
      // "draw" whenever more than nothing happened.
      const one = damageThenCheck(start, [burn(source, 0, 1), burn(source, 1, 2)]);
      const decided = one.state.result;
      if (decided === null) throw new Error('the one-sided batch did not end the game');
      expect(isDraw(decided)).toBe(false);
      expect(decided.winner).toBe(0);
      expect(decided.loser).toBe(1);
    },
  ),
];
