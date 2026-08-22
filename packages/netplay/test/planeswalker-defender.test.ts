import { describe, expect, it } from 'vitest';
import { readDeclaration } from '../src/protocol';

describe('planeswalker defenders on the declaration wire', () => {
  it('preserves numeric player and tagged planeswalker defenders', () => {
    const declaration = readDeclaration(
      {
        type: 'declareAttackers',
        player: 0,
        attackers: [
          { oid: 'attacker-player', defender: 1 },
          { oid: 'attacker-walker', defender: { kind: 'planeswalker', oid: 'walker-1' } },
        ],
      },
      'declaration',
    );

    expect(declaration).toEqual({
      type: 'declareAttackers',
      player: 0,
      attackers: [
        { oid: 'attacker-player', defender: 1 },
        { oid: 'attacker-walker', defender: { kind: 'planeswalker', oid: 'walker-1' } },
      ],
    });
  });

  it('rejects an untagged object and an empty planeswalker identity', () => {
    expect(
      readDeclaration(
        {
          type: 'declareAttackers',
          player: 0,
          attackers: [{ oid: 'attacker', defender: { oid: 'walker-1' } }],
        },
        'declaration',
      ),
    ).toContain('is not a seat or planeswalker');
    expect(
      readDeclaration(
        {
          type: 'declareAttackers',
          player: 0,
          attackers: [{ oid: 'attacker', defender: { kind: 'planeswalker', oid: '' } }],
        },
        'declaration',
      ),
    ).toContain('is not an object id');
  });
});
