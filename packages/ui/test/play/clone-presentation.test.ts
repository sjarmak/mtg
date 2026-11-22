import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { beginTrace, moveObject, scenario, type GameState } from '@mtg/kernel';
import { nameOf } from '../../src/routes/play/naming';
import { boardPosition } from '../../src/routes/play/position';

const CLONE = parseCard({
  kind: 'creature',
  id: 'ui-clone',
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
  id: 'ui-sage',
  name: 'UI Sage',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 2, U: 1 },
  colors: ['U'],
  subtypes: ['Wizard'],
  keywords: ['flying'],
  power: 3,
  toughness: 4,
});

function copiedClone(): { readonly state: GameState; readonly oid: string } {
  const opened = scenario({ battlefield: [{ card: SAGE, controller: 0 }] }).state;
  const oid = opened.battlefield[0];
  if (oid === undefined) throw new Error('scenario built no Clone');
  return {
    oid,
    state: {
      ...opened,
      objects: {
        ...opened.objects,
        [oid]: { ...opened.objects[oid]!, card: CLONE, copiableCard: SAGE },
      },
    },
  };
}

describe('copied permanent presentation', () => {
  it('uses the copied face and name on the battlefield, then the physical face after departure', () => {
    const copied = copiedClone();
    const position = boardPosition(copied.state, 0, ['You', 'Bot']);

    expect(nameOf(copied.state, copied.oid)).toBe('UI Sage');
    expect(position.you.battlefield.permanents[0]?.card).toEqual(SAGE);

    const left = moveObject(beginTrace(copied.state), copied.oid, 'exile').state;
    expect(nameOf(left, copied.oid)).toBe('Clone');
  });
});
