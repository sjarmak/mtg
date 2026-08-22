/**
 * `youCastSpell` and `youCastInstantOrSorcery`: CR 601.2i's "whenever you
 * cast a spell" trigger, and its instant-or-sorcery-filtered sibling.
 *
 * Both read `spellCast`, which `pushSpell` emits once payment is made and the
 * spell object is on the stack — before it resolves, which is why casting
 * alone is enough to assert against; nothing here needs to pass priority.
 * `event.oid` names the spell, so the filter reads the spell's own card kind
 * rather than the watcher's, and `event.player` is the caster, so the scope
 * check is "you cast" rather than "a spell was cast".
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { eventsOfType, reduce, scenario, type ObjectId, type ReduceResult } from '@mtg/kernel';
import { creature, instant, MOUNTAIN, sorcery } from './cards';
import { handOidOf, oidOf } from './helpers';

function castWarden(name: string, condition: 'youCastSpell' | 'youCastInstantOrSorcery'): Card {
  return creature(name, 2, 2, {
    abilities: [
      {
        kind: 'triggered',
        condition,
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ],
  });
}

const GAIN_LIFE_EFFECT = [{ kind: 'gainLife' as const, amount: 1, target: { kind: 'noTarget' as const } }];

function conditionsFiredBy(result: ReduceResult, source: ObjectId): readonly string[] {
  return eventsOfType(result.events, 'abilityTriggered')
    .filter((event) => event.source === source)
    .map((event) => event.condition);
}

describe('whenever you cast a spell', () => {
  it('fires the unfiltered watcher but not the instant-or-sorcery watcher when a creature spell is cast', () => {
    const spellWarden = castWarden('Spell Warden', 'youCastSpell');
    const isWarden = castWarden('Instant Sorcery Warden', 'youCastInstantOrSorcery');
    const body = creature('Plain Body', 2, 2);
    const start = scenario({
      battlefield: [
        { card: spellWarden, controller: 0 },
        { card: isWarden, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[body], []],
    }).state;
    const oid = handOidOf(start, 0, 'Plain Body');
    const result = reduce(start, { type: 'castSpell', player: 0, oid, targets: [] });

    const spellOid = oidOf(result.state, 'Spell Warden');
    const isOid = oidOf(result.state, 'Instant Sorcery Warden');
    expect(conditionsFiredBy(result, spellOid)).toEqual(['youCastSpell']);
    expect(conditionsFiredBy(result, isOid)).toEqual([]);
  });

  it('fires both watchers when an instant is cast', () => {
    const spellWarden = castWarden('Spell Warden', 'youCastSpell');
    const isWarden = castWarden('Instant Sorcery Warden', 'youCastInstantOrSorcery');
    const bolt = instant('Test Bolt', GAIN_LIFE_EFFECT);
    const start = scenario({
      battlefield: [
        { card: spellWarden, controller: 0 },
        { card: isWarden, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[bolt], []],
    }).state;
    const oid = handOidOf(start, 0, 'Test Bolt');
    const result = reduce(start, { type: 'castSpell', player: 0, oid, targets: [null] });

    const spellOid = oidOf(result.state, 'Spell Warden');
    const isOid = oidOf(result.state, 'Instant Sorcery Warden');
    expect(conditionsFiredBy(result, spellOid)).toEqual(['youCastSpell']);
    expect(conditionsFiredBy(result, isOid)).toEqual(['youCastInstantOrSorcery']);
  });

  it('fires both watchers when a sorcery is cast', () => {
    const spellWarden = castWarden('Spell Warden', 'youCastSpell');
    const isWarden = castWarden('Instant Sorcery Warden', 'youCastInstantOrSorcery');
    const growth = sorcery('Test Growth', GAIN_LIFE_EFFECT);
    const start = scenario({
      battlefield: [
        { card: spellWarden, controller: 0 },
        { card: isWarden, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[growth], []],
    }).state;
    const oid = handOidOf(start, 0, 'Test Growth');
    const result = reduce(start, { type: 'castSpell', player: 0, oid, targets: [null] });

    const spellOid = oidOf(result.state, 'Spell Warden');
    const isOid = oidOf(result.state, 'Instant Sorcery Warden');
    expect(conditionsFiredBy(result, spellOid)).toEqual(['youCastSpell']);
    expect(conditionsFiredBy(result, isOid)).toEqual(['youCastInstantOrSorcery']);
  });

  it('does not fire for a spell the opponent casts', () => {
    const spellWarden = castWarden('Spell Warden', 'youCastSpell');
    const body = creature('Plain Body', 2, 2);
    const start = scenario({
      battlefield: [
        { card: spellWarden, controller: 0 },
        { card: MOUNTAIN, controller: 1 },
      ],
      hands: [[], [body]],
      active: 1,
    }).state;
    const oid = handOidOf(start, 1, 'Plain Body');
    const result = reduce(start, { type: 'castSpell', player: 1, oid, targets: [] });

    const spellOid = oidOf(result.state, 'Spell Warden');
    expect(conditionsFiredBy(result, spellOid)).toEqual([]);
  });
});
