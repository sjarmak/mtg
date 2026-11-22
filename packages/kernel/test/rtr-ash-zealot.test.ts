/** Cast-origin provenance and retained-caster execution for RTR Ash Zealot. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  moveObject,
  putTriggersOnStack,
  resolveTop,
  scenario,
  type ObjectId,
  type PlayerId,
  type ReduceResult,
  type Trace,
  type ZoneId,
} from '@mtg/kernel';
import { pushCopiedCardSpell, pushSpell } from '../src/stack';
import { instant } from './cards';
import { oidOf } from './helpers';

const ASH_ZEALOT = parseCard({
  kind: 'creature',
  id: 'rtr-086-ash-zealot-kernel',
  name: 'Ash Zealot',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 86 },
  manaCost: { R: 2 },
  colors: ['R'],
  subtypes: ['Human', 'Warrior'],
  keywords: ['firstStrike', 'haste'],
  keywordLineGroups: [['firstStrike', 'haste']],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'youCastSpell',
      castFromGraveyardByAnyPlayer: true,
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'triggeringPlayer' } }],
    },
  ],
});

const PROBE = instant('Ash Zealot Probe', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }]);

function opened(zone: Exclude<ZoneId, 'battlefield' | 'stack'>, caster: PlayerId): ReduceResult {
  const run = scenario({
    battlefield: [{ card: ASH_ZEALOT, controller: 0 }],
    hands: zone === 'hand' ? (caster === 0 ? [[PROBE], []] : [[], [PROBE]]) : [[], []],
    graveyards: zone !== 'hand' ? (caster === 0 ? [[PROBE], []] : [[], [PROBE]]) : [[], []],
    active: caster,
  });
  if (zone !== 'exile') return run;
  const moved = moveObject(beginTrace(run.state), probeOid(run), 'exile');
  return { state: moved.state, events: moved.events };
}

function probeOid(run: ReduceResult): ObjectId {
  const found = Object.values(run.state.objects).find((object) => object.card.name === PROBE.name)?.oid;
  if (found === undefined) throw new Error('Ash Zealot probe object is absent');
  return found;
}

function realCast(run: ReduceResult, caster: PlayerId): Trace {
  return pushSpell(beginTrace(run.state), caster, probeOid(run), [null], null, null);
}

function fired(trace: Trace) {
  return collectTriggers(trace, 0).filter((trigger) => {
    const ability = trigger.sourceCard.abilities[trigger.index];
    return (
      trigger.condition === 'youCastSpell' &&
      ability?.kind === 'triggered' &&
      ability.castFromGraveyardByAnyPlayer === true
    );
  });
}

describe('Ash Zealot in the kernel', () => {
  it.each([0, 1] as const)('fires for player %i and damages exactly that caster', (caster) => {
    const cast = realCast(opened('graveyard', caster), caster);
    const triggers = fired(cast);

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.triggeringPlayer).toBe(caster);
    const resolved = resolveTop(putTriggersOnStack(cast, triggers));
    expect(resolved.state.players.map((player) => player.life)).toEqual(caster === 0 ? [17, 20] : [20, 17]);
  });

  it.each(['hand', 'exile'] as const)('ignores a real cast from %s', (zone) => {
    expect(fired(realCast(opened(zone, 0), 0))).toEqual([]);
  });

  it('does not mistake a copied-card cast for a cast from the original graveyard zone', () => {
    const run = opened('graveyard', 0);
    const oid = probeOid(run);
    if (PROBE.kind !== 'instant') throw new Error('Ash Zealot probe stopped being an instant');
    const copied = pushCopiedCardSpell(beginTrace(run.state), 0, oid, PROBE, [null], null, null);

    expect(fired(copied)).toEqual([]);
  });

  it('keeps the trigger and its caster after both the source and spell leave', () => {
    const run = opened('graveyard', 1);
    const source = oidOf(run.state, ASH_ZEALOT.name);
    const cast = realCast(run, 1);
    const triggers = fired(cast);
    const sourceGone = moveObject(cast, source, 'graveyard');
    const spellGone = moveObject(sourceGone, probeOid(run), 'graveyard');
    const resolved = resolveTop(putTriggersOnStack(spellGone, triggers));

    expect(resolved.state.objects[source]?.zone).toBe('graveyard');
    expect(resolved.state.players.map((player) => player.life)).toEqual([20, 17]);
  });
});
