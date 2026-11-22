import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { scenario, type GameState } from '@mtg/kernel';
import { describePermanent } from '../src/describe';

const CLONE = parseCard({
  kind: 'creature',
  id: 'ref-clone',
  name: 'Clone',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 49 },
  manaCost: { generic: 3, U: 1 },
  colors: ['U'],
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: { kind: 'entersAsCopyOfCreature' },
});

const SAGE = parseCard({
  kind: 'creature',
  id: 'ref-sage',
  name: 'Referee Sage',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 2, U: 1 },
  colors: ['U'],
  subtypes: ['Wizard'],
  keywords: ['flying'],
  power: 3,
  toughness: 4,
});

describe('copied permanent referee framing', () => {
  it('describes the copied battlefield face rather than physical Clone', () => {
    const opened = scenario({ battlefield: [{ card: SAGE, controller: 0 }] }).state;
    const oid = opened.battlefield[0];
    if (oid === undefined) throw new Error('scenario built no Clone');
    const state: GameState = {
      ...opened,
      objects: {
        ...opened.objects,
        [oid]: { ...opened.objects[oid]!, card: CLONE, copiableCard: SAGE },
      },
    };

    expect(describePermanent(state, oid)).toContain('Referee Sage');
    expect(describePermanent(state, oid)).toContain('Flying');
    expect(describePermanent(state, oid)).not.toContain('enter as a copy');
  });
});
