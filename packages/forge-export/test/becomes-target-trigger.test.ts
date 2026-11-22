/**
 * Phantom Beast against Forge's current checked-in card script.
 *
 * Card-Forge/forge 7ba1a393 writes `BecomesTarget`, `Card.Self`, and an explicit
 * battlefield trigger zone. Those three parameters are the semantic boundary:
 * omitting the self filter watches every target, and omitting the zone can make
 * a source trigger from somewhere the kernel never scans it.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const PHANTOM_BEAST = parseCard({
  kind: 'creature',
  id: 'm11-phantom-beast',
  name: 'Phantom Beast',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 69 },
  manaCost: { generic: 3, U: 1 },
  colors: ['U'],
  subtypes: ['Illusion', 'Beast'],
  power: 4,
  toughness: 5,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfBecomesTarget',
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
    },
  ],
});

describe('Phantom Beast in Forge', () => {
  const script = mustTranspile(PHANTOM_BEAST);

  it('writes the exact upstream target-trigger selectors', () => {
    expect(script).toContain(
      'T:Mode$ BecomesTarget | ValidTarget$ Card.Self | TriggerZones$ Battlefield | ' +
        'Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME becomes the target of a spell or ability, sacrifice this creature.',
    );
  });

  it('sacrifices the source and keeps the exact Oracle line', () => {
    expect(script).toContain('SVar:Trig1Effect1:DB$ Sacrifice | SacValid$ Self');
    expect(renderOracleText(PHANTOM_BEAST)).toBe(
      'When Phantom Beast becomes the target of a spell or ability, sacrifice this creature.',
    );
    expect(script).toContain(`Oracle:${renderOracleText(PHANTOM_BEAST)}`);
  });
});
