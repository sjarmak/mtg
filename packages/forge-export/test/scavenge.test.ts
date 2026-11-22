/** Source-proven Forge parity for scavenge and generic sorcery-speed activations. */
import { describe, expect, it } from 'vitest';
import { mana, parseCard, scavengeAbility } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const GOLIATH = parseCard({
  kind: 'creature',
  id: 'rtr-120-deadbridge-goliath',
  name: 'Deadbridge Goliath',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 120 },
  colors: ['G'],
  manaCost: { generic: 2, G: 2 },
  subtypes: ['Insect'],
  power: 5,
  toughness: 5,
  abilities: [scavengeAbility(mana({ generic: 4, G: 2 }), 5)],
});

describe('scavenge Forge export', () => {
  it('uses Forge own source-proven keyword line', () => {
    const result = transpileCard(GOLIATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain('K:Scavenge:4 G G');
    expect(result.script.text).not.toContain('A:AB$ PutCounter');
  });

  it('carries the reusable timing field onto an ordinary Forge activation', () => {
    const trainer = parseCard({
      kind: 'creature',
      id: 'tst-sorcery-speed-trainer',
      name: 'Sorcery Speed Trainer',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      colors: ['G'],
      manaCost: { G: 1 },
      subtypes: ['Druid'],
      power: 1,
      toughness: 1,
      abilities: [
        {
          kind: 'activated',
          activateOnlyAsSorcery: true,
          cost: { mana: { generic: 1 } },
          effects: [
            {
              kind: 'putCounters',
              counter: 'plusOnePlusOne',
              count: 1,
              target: { kind: 'targetCreature' },
            },
          ],
        },
      ],
    });
    const result = transpileCard(trainer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain('SorcerySpeed$ True');
    expect(result.script.text).toContain('Activate only as a sorcery.');
  });

  it('carries the reusable timing field through Forge regeneration special-casing', () => {
    const regenerator = parseCard({
      kind: 'creature',
      id: 'tst-sorcery-speed-regenerator',
      name: 'Sorcery Speed Regenerator',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      colors: ['G'],
      manaCost: { G: 1 },
      subtypes: ['Plant'],
      power: 1,
      toughness: 1,
      abilities: [
        {
          kind: 'activated',
          activateOnlyAsSorcery: true,
          cost: { mana: { G: 1 } },
          regenerateSelf: true,
          effects: [],
        },
      ],
    });
    const result = transpileCard(regenerator);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain('SorcerySpeed$ True');
    expect(result.script.text).toContain('Activate only as a sorcery.');
  });
});
