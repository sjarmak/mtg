import { expect, it } from 'vitest';
import { inventoryForgeScriptSyntax } from '../src/node/index';

const bytes = new TextEncoder().encode(`Name:Fixture
ManaCost:X R
Types:Creature Human Warrior
K:Exert
T:Mode$ Exerted | ValidCard$ Card.Self | Execute$ DoDamage
SVar:DoDamage:DB$ DealDamage | Defined$ Opponent | NumDmg$ 2
SVar:Pump:AB$ Pump | Cost$ Sac<1/CARDNAME> | ValidTgts$ Creature
`);

it('inventories the deterministic Forge script grammar without assigning meaning', () => {
  expect(inventoryForgeScriptSyntax(bytes)).toEqual([
    { kind: 'ability-api', token: 'DealDamage' },
    { kind: 'ability-api', token: 'Exerted' },
    { kind: 'ability-api', token: 'Pump' },
    { kind: 'keyword', token: 'Exert' },
    { kind: 'line-kind', token: 'K' },
    { kind: 'line-kind', token: 'ManaCost' },
    { kind: 'line-kind', token: 'Name' },
    { kind: 'line-kind', token: 'SVar' },
    { kind: 'line-kind', token: 'T' },
    { kind: 'line-kind', token: 'Types' },
    { kind: 'parameter-key', token: 'AB' },
    { kind: 'parameter-key', token: 'Cost' },
    { kind: 'parameter-key', token: 'DB' },
    { kind: 'parameter-key', token: 'Defined' },
    { kind: 'parameter-key', token: 'Execute' },
    { kind: 'parameter-key', token: 'Mode' },
    { kind: 'parameter-key', token: 'NumDmg' },
    { kind: 'parameter-key', token: 'ValidCard' },
    { kind: 'parameter-key', token: 'ValidTgts' },
    { kind: 'semantic-marker', token: 'card-enters-combat' },
    { kind: 'semantic-marker', token: 'discard-or-sacrifice-cost' },
    { kind: 'semantic-marker', token: 'priority-window' },
    { kind: 'semantic-marker', token: 'variable-payment' },
  ]);
});

it('rejects malformed UTF-8 before producing a partial inventory', () => {
  expect(() => inventoryForgeScriptSyntax(Uint8Array.of(0xff))).toThrow(/UTF-8/i);
});
