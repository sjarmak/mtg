import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import catalog from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { CARD_PROFILES } from '../src/advisor/card-profiles';
import { LEGACY_CUBE_NAMES_SHA256, validateAdvisorMetadata } from '../src/advisor/validate';
const profile = (name: string) => CARD_PROFILES.find((p) => p.name === name)!;

it('accounts for all 600 identities and rejects stale catalog content', () => {
  expect(
    createHash('sha256')
      .update(catalog.cards.map((card) => card.correctedName).join('\n'))
      .digest('hex'),
  ).toBe(LEGACY_CUBE_NAMES_SHA256);
  expect(validateAdvisorMetadata(catalog).errors).toEqual([]);
  expect(new Set(CARD_PROFILES.map((p) => p.name)).size).toBe(600);
  expect(CARD_PROFILES.every((p) => p.neutral === (p.archetypes.length === 0))).toBe(true);
  expect(validateAdvisorMetadata({ ...catalog, contentSha256: 'changed' }).ok).toBe(false);
  expect(validateAdvisorMetadata({ ...catalog, cards: catalog.cards.slice(1) }).ok).toBe(false);
});

it('separates actual accelerators, threats, spells and fixing', () => {
  expect(profile('Llanowar Elves').tags).toContain('accelerator');
  expect(profile('Llanowar Elves').tags).not.toContain('ramp-payoff');
  expect(profile('Wall of Omens').tags).toEqual(
    expect.arrayContaining(['creature', 'etb', 'card-advantage']),
  );
  expect(profile('Wall of Omens').tags).not.toContain('threat');
  expect(profile('Lightning Bolt').tags).toEqual(expect.arrayContaining(['spell', 'interaction']));
  expect(profile('Thalia, Guardian of Thraben').tags).not.toContain('spells-payoff');
  expect(profile('Flooded Strand').fixing).toEqual(['W', 'U']);
  expect(profile('Prismatic Vista').fixing).toHaveLength(5);
  expect(profile('Grim Monolith').fixing).toEqual([]);
  expect(profile('Wasteland').tags).not.toContain('accelerator');
  expect(profile('Wasteland').fixing).toEqual([]);
});

it('preserves multi-role bridges and actual narrow dependencies', () => {
  expect(profile('Liliana of the Veil').tags).toContain('discard-outlet');
  expect(profile('Liliana of the Veil').archetypes.map((a) => a.archetype)).toEqual(
    expect.arrayContaining(['reanimator', 'control', 'midrange']),
  );
  expect(profile('Sneak Attack').tags).toContain('cheat');
  expect(profile('Griselbrand').tags).toEqual(expect.arrayContaining(['cheat-target', 'reanimation-target']));
  expect(profile('Emrakul, the Aeons Torn').tags).not.toContain('reanimation-target');
  expect(profile('Natural Order').tags).toContain('natural-order');
  expect(profile('Craterhoof Behemoth').tags).toEqual(
    expect.arrayContaining(['natural-order-target', 'ramp-payoff', 'go-wide-payoff']),
  );
  expect(profile("Urza's Saga").tags).toContain('artifact-payoff');
  expect(profile("Urza's Saga").tags).not.toContain('etb');
  expect(profile('Opposition').tags).toContain('tap-payoff');
  expect(profile('Splinter Twin').tags).not.toContain('kiki-copy');
  expect(profile('Restoration Angel').tags).toContain('kiki-partner');
  expect(profile('Restoration Angel').tags).not.toContain('twin-partner');
});
