/** Dryad Militant replaces only instant and sorcery card moves to graveyards. */
import { parseCard } from '@mtg/dsl';
import { beginTrace, eventsOfType, getObject, moveObject, onlyObject, scenario } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { abilities, copies, withContinuous } from './continuous-helpers';
import { creature, instant, sorcery } from './cards';
import { handOidOf, oidOf } from './helpers';

const DRYAD_MILITANT = parseCard({
  kind: 'creature',
  id: 'rtr-214-dryad-militant-kernel',
  name: 'Dryad Militant',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 214 },
  manaCost: { hybrid: { 'G/W': 1 } },
  printedHybridManaReminder: true,
  colors: ['G', 'W'],
  subtypes: ['Dryad', 'Soldier'],
  power: 2,
  toughness: 1,
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'eachPlayer',
      rule: 'instantOrSorceryCardsToGraveyardAreExiled',
    },
  ],
});

const BLANK = creature('Dryad Militant Blank', 1, 1);
const CREATURE_CARD = creature('Dryad Militant Creature Card', 2, 2);
const SPELL_EFFECTS = [{ kind: 'gainLife' as const, amount: 1, target: { kind: 'noTarget' as const } }];
const INSTANT_CARD = instant('Dryad Militant Instant Card', SPELL_EFFECTS);
const SORCERY_CARD = sorcery('Dryad Militant Sorcery Card', SPELL_EFFECTS);
const TOKEN = creature('Dryad Militant Token', 1, 1);

describe('Dryad Militant in the kernel', () => {
  it('exiles instant and sorcery cards for both owners while leaving other cards and tokens alone', () => {
    const start = scenario({
      battlefield: [
        { card: DRYAD_MILITANT, controller: 0 },
        { card: TOKEN, controller: 1, token: true },
      ],
      hands: [[INSTANT_CARD, CREATURE_CARD], [SORCERY_CARD]],
    }).state;
    const instantOid = handOidOf(start, 0, INSTANT_CARD.name);
    const creatureOid = handOidOf(start, 0, CREATURE_CARD.name);
    const sorceryOid = handOidOf(start, 1, SORCERY_CARD.name);
    const tokenOid = oidOf(start, TOKEN.name);

    let moved = moveObject(beginTrace(start), instantOid, 'graveyard');
    moved = moveObject(moved, sorceryOid, 'graveyard');
    moved = moveObject(moved, creatureOid, 'graveyard');
    moved = moveObject(moved, tokenOid, 'graveyard');

    expect([instantOid, sorceryOid].map((oid) => getObject(moved.state, oid).zone)).toEqual([
      'exile',
      'exile',
    ]);
    expect([creatureOid, tokenOid].map((oid) => getObject(moved.state, oid).zone)).toEqual([
      'graveyard',
      'graveyard',
    ]);
    expect(eventsOfType(moved.events, 'replacementApplied')).toHaveLength(2);
  });

  it('tracks layer-derived copying and ability loss, then stops after source departure', () => {
    const start = scenario({
      battlefield: [
        { card: DRYAD_MILITANT, controller: 0 },
        { card: BLANK, controller: 1 },
      ],
      hands: [[INSTANT_CARD], [SORCERY_CARD]],
    }).state;
    const source = oidOf(start, DRYAD_MILITANT.name);
    const blank = oidOf(start, BLANK.name);
    const copied = withContinuous(start, [
      copies(onlyObject(blank), source),
      abilities(onlyObject(source), { removeAll: true }),
    ]);
    const firstOid = handOidOf(copied, 0, INSTANT_CARD.name);
    const copiedMove = moveObject(beginTrace(copied), firstOid, 'graveyard');
    expect(getObject(copiedMove.state, firstOid).zone).toBe('exile');

    const stripped = withContinuous(copiedMove.state, [abilities(onlyObject(blank), { removeAll: true })]);
    const secondOid = handOidOf(stripped, 1, SORCERY_CARD.name);
    const strippedMove = moveObject(beginTrace(stripped), secondOid, 'graveyard');
    expect(getObject(strippedMove.state, secondOid).zone).toBe('graveyard');

    const ordinary = scenario({
      battlefield: [{ card: DRYAD_MILITANT, controller: 0 }],
      hands: [[INSTANT_CARD], []],
    }).state;
    const departed = moveObject(beginTrace(ordinary), oidOf(ordinary, DRYAD_MILITANT.name), 'graveyard');
    const afterDepartureOid = handOidOf(departed.state, 0, INSTANT_CARD.name);
    const afterDeparture = moveObject(departed, afterDepartureOid, 'graveyard');
    expect(getObject(afterDeparture.state, afterDepartureOid).zone).toBe('graveyard');
  });
});
