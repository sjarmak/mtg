/**
 * The Forge play boundary, exercised with a deliberately tiny JSONL companion.
 *
 * These tests own process behavior rather than Forge behavior: a fake child can
 * answer instantly, die at an exact point, or write an exact malformed byte
 * sequence. The real-Forge test beside this file proves that the same transport
 * reaches Forge 2.0.14 and finishes a match; this file makes failures at the
 * boundary attributable instead of asking a four-second JVM boot to race a
 * timeout.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionSpec } from '@mtg/engine';
import { COMMANDER_RULES, MOMIR_RULES } from '@mtg/engine';
import {
  forgeObservedAdmittedBackend,
  forgeObservedBackend,
  forgeObservedDiagnosticBackend,
} from '@mtg/forge-export';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Human',
      controller: 'local',
      deck: { name: 'red', cards: [{ name: 'Mountain', count: 60 }] },
    },
    {
      name: 'Forge AI',
      controller: 'engine',
      deck: { name: 'red-ai', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '7',
  maximumTurns: 80,
};

const COMMANDER_TABLE: SessionSpec = {
  ...TABLE,
  rules: COMMANDER_RULES,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'ragavan',
        cards: [{ name: 'Mountain', count: 99 }],
        commanders: [{ name: 'Ragavan, Nimble Pilferer', count: 1 }],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'thalia',
        cards: [{ name: 'Plains', count: 99 }],
        commanders: [{ name: 'Thalia, Guardian of Thraben', count: 1 }],
      },
    },
  ],
};

const MOMIR_TABLE: SessionSpec = {
  ...TABLE,
  rules: MOMIR_RULES,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'momir',
        cards: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((name) => ({ name, count: 12 })),
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'momir',
        cards: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((name) => ({ name, count: 12 })),
      },
    },
  ],
};

const CHILD = String.raw`
const readline = require('node:readline');
const fs = require('node:fs');
const behavior = process.env.BEHAVIOR || 'normal';
const protocolVersion = behavior === 'version' ? 1 : 2;
let revision = 0;
let startingLife = 20;
function snapshot(requestId) {
  const targetFlow = behavior === 'target' || behavior === 'bad-target';
  const zoneFlow = behavior === 'zone';
  const handToLibraryFlow = behavior === 'hand-to-library';
  const discardFlow = behavior === 'discard';
  const colorFlow = behavior === 'color';
  const parityFlow = behavior === 'parity';
  const abilityFlow = behavior === 'ability';
  const spellFlow = behavior === 'spell';
  const combatFlow = behavior === 'combat' || behavior === 'combat-defenders' || behavior === 'combat-ambiguous';
  const manaFlow = behavior === 'mana';
  const manaUndoFlow = behavior === 'mana-undo';
  const startingPlayerFlow = behavior === 'starting-player';
  const mulliganFlow = behavior === 'mulligan';
  const manaPaymentFlow = behavior === 'mana-payment';
  const phyrexianPaymentFlow = behavior === 'phyrexian-payment';
  const phyrexianChoiceFlow = behavior === 'phyrexian-choice';
  const manaPlanFlow = behavior === 'mana-plan';
  const playerTargetFlow = behavior === 'player-target';
  const commanderFlow = behavior === 'commander';
  const momirFlow = behavior === 'momir';
  const oracleFlow = behavior === 'oracle';
  const finished = targetFlow || playerTargetFlow || zoneFlow || handToLibraryFlow || discardFlow || colorFlow || parityFlow ? revision >= 2 : revision >= 1;
  const targetOptions = [
    { id: 'target-card-41', text: 'Target Mountain [target-card-41]', targets: [{ oid: 'forge-card-41', name: 'Mountain' }] },
    { id: 'target-card-42', text: 'Target Mountain [target-card-42]', targets: [{ oid: 'forge-card-42', name: 'Mountain' }] },
    { id: 'target-cancel', text: 'Cancel casting Vindicate', targets: [] }
  ];
  const zoneOptions = [
    { id: 'zone-card-61', text: 'Choose Farseek [zone-card-61]', targets: [{ oid: 'forge-card-61', name: 'Farseek' }] },
    { id: 'zone-card-62', text: 'Choose Farseek [zone-card-62]', targets: [{ oid: 'forge-card-62', name: 'Farseek' }] },
    { id: 'zone-decline', text: 'Find no card', targets: [] }
  ];
  const discardOptions = [
    { id: 'discard-card-71', text: 'Discard Island [discard-card-71]', targets: [{ oid: 'forge-card-71', name: 'Island' }] },
    { id: 'discard-card-72', text: 'Discard Island [discard-card-72]', targets: [{ oid: 'forge-card-72', name: 'Island' }] }
  ];
  const colorOptions = ['W', 'U', 'B', 'R', 'G'].map(symbol => ({
    id: 'color-choice-' + symbol,
    text: 'Choose ' + symbol + ' for Coldsteel Heart',
    targets: [{ oid: 'forge-card-81', name: 'Coldsteel Heart' }]
  }));
  const parityOptions = ['odd', 'even'].map(parity => ({
    id: 'parity-choice-' + parity,
    text: 'Choose ' + parity + ' for Extinction Event',
    targets: [{ oid: 'forge-card-91', name: 'Extinction Event' }]
  }));
  const response = {
    protocolVersion,
    type: 'snapshot',
    requestId,
    sessionId: 'forge-session-1',
    revision,
    status: finished ? 'finished' : 'awaiting',
    view: {
      version: 4,
      turn: { number: 1, active: 0, phase: combatFlow ? 'Combat' : 'Main', step: combatFlow ? 'COMBAT_DECLARE_ATTACKERS' : 'MAIN1' },
      priority: revision === 0 ? 0 : null,
      stack: [],
      seats: [
        { id: 0, name: 'Human', life: startingLife, hand: discardFlow || handToLibraryFlow ? [
          { oid: 'forge-card-71', name: 'Island', typeLine: 'Basic Land — Island', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 0, counters: {} },
          { oid: 'forge-card-72', name: 'Island', typeLine: 'Basic Land — Island', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 0, counters: {} }
        ] : abilityFlow ? [
          { oid: 'forge-card-73', name: 'Plains', typeLine: 'Basic Land — Plains', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 0, counters: {} }
        ] : spellFlow ? [
          { oid: 'forge-card-76', name: 'Lightning Bolt', typeLine: 'Instant', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 0, counters: {} }
        ] : [], handSize: discardFlow || handToLibraryFlow ? 2 : abilityFlow || spellFlow ? 1 : 0, librarySize: 60, graveyard: [], exile: [], battlefield: combatFlow ? [
          { oid: 'forge-card-74', name: 'Savannah Lions', typeLine: 'Creature — Cat', power: 2, toughness: 1, tapped: false, attacking: false, damage: 0, controller: 0, counters: {} }
        ] : manaPlanFlow ? [
          { oid: 'forge-card-43', name: 'Flexible Land', typeLine: 'Land', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 0, counters: {} },
          { oid: 'forge-card-46', name: 'Other Land', typeLine: 'Land', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 0, counters: {} }
        ] : manaFlow || manaUndoFlow || manaPaymentFlow || phyrexianChoiceFlow ? [
          { oid: 'forge-card-75', name: phyrexianChoiceFlow ? 'Island' : 'Forest', typeLine: phyrexianChoiceFlow ? 'Basic Land — Island' : 'Basic Land — Forest', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 0, counters: {} }
        ] : [] },
        { id: 1, name: 'Forge AI', life: startingLife, hand: null, handSize: 0, librarySize: 60, graveyard: [], exile: [], battlefield: targetFlow ? [
          { oid: 'forge-card-41', name: 'Mountain', typeLine: 'Basic Land — Mountain', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 1, counters: {} },
          { oid: 'forge-card-42', name: 'Mountain', typeLine: 'Basic Land — Mountain', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 1, counters: {} }
        ] : [] }
      ]
    },
    events: finished ? [{ seq: 0, type: 'Game outcome', text: 'Human won', detail: null, reveals: [] }] : [],
    ...(manaUndoFlow ? { manaPools: [
      { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
      { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    ] } : {}),
    decision: finished ? null : revision === 0 ? {
      seat: 0,
      kind: startingPlayerFlow ? 'starting-player' : mulliganFlow ? 'mulligan' : manaPaymentFlow || manaPlanFlow || phyrexianPaymentFlow || phyrexianChoiceFlow ? 'mana-payment' : combatFlow ? 'combat-attackers' : 'priority',
      prompt: 'Human has priority',
      ...(manaPlanFlow ? { manaPayment: { unpaid: ['1', 'G'] } } : manaPaymentFlow ? { manaPayment: { unpaid: ['G'] } } : phyrexianChoiceFlow ? { manaPayment: { unpaid: ['U/P'] } } : {}),
      options: startingPlayerFlow ? [
        { id: 'pregame-start-seat-0', text: 'Play first', targets: [] },
        { id: 'pregame-start-seat-1', text: 'Let bot play first', targets: [] }
      ] : mulliganFlow ? [
        { id: 'pregame-keep', text: 'Keep this hand', targets: [] },
        { id: 'pregame-mulligan', text: 'Take a mulligan', targets: [] }
      ] : phyrexianChoiceFlow ? [
        { id: 'mana-source-75-0-U', text: 'Activate Island', targets: [{ oid: 'forge-card-75', name: 'Island' }], manaPayment: { kind: 'mana', resource: 'forge-card-75', color: 'U' } },
        { id: 'mana-payment-phyrexian-life', text: 'Pay 2 life for a Phyrexian mana', targets: [], manaPayment: { kind: 'phyrexian-life' } },
        { id: 'mana-payment-cancel', text: 'Cancel mana payment', targets: [], manaPayment: { kind: 'cancel' } }
      ] : phyrexianPaymentFlow ? [
        { id: 'mana-payment-phyrexian-life', text: 'Pay 2 life for a Phyrexian mana', targets: [] },
        { id: 'mana-payment-cancel', text: 'Cancel mana payment', targets: [] }
      ] : manaPlanFlow ? [
        { id: 'mana-source-43-0-U', text: 'misleading', targets: [{ oid: 'forge-card-43', name: 'Flexible Land' }], manaPayment: { kind: 'mana', resource: 'forge-card-43', color: 'U' } },
        { id: 'mana-source-43-1-G', text: 'misleading', targets: [{ oid: 'forge-card-43', name: 'Flexible Land' }], manaPayment: { kind: 'mana', resource: 'forge-card-43', color: 'G' } },
        { id: 'mana-source-46-0-B', text: 'misleading', targets: [{ oid: 'forge-card-46', name: 'Other Land' }], manaPayment: { kind: 'mana', resource: 'forge-card-46', color: 'B' } },
        { id: 'mana-source-46-0-R', text: 'misleading', targets: [{ oid: 'forge-card-46', name: 'Other Land' }], manaPayment: { kind: 'mana', resource: 'forge-card-46', color: 'R' } },
        { id: 'mana-payment-cancel', text: 'misleading', targets: [], manaPayment: { kind: 'cancel' } }
      ] : manaPaymentFlow ? [
        { id: 'mana-source-75-0-G', text: 'Pay with Forest', targets: [{ oid: 'forge-card-75', name: 'Forest' }], manaPayment: { kind: 'mana', resource: 'forge-card-75', color: 'G' } },
        { id: 'mana-payment-cancel', text: 'Cancel mana payment', targets: [], manaPayment: { kind: 'cancel' } }
      ] : abilityFlow ? [
        { id: 'pass', text: 'Pass priority', targets: [] },
        { id: 'concede', text: 'Concede game', targets: [] },
        { id: 'ability-73-0', text: 'words are presentation only', targets: [] }
      ] : spellFlow ? [
        { id: 'pass', text: 'Pass priority', targets: [] },
        { id: 'ability-76-0', text: 'words are presentation only', targets: [] }
      ] : momirFlow ? [
        { id: 'pass', text: 'Pass priority', targets: [] },
        { id: 'ability-111-0', text: 'Activate Momir Vig', targets: [] }
      ] : commanderFlow ? [
        { id: 'pass', text: 'Pass priority', targets: [] },
        { id: 'ability-101-0', text: 'Cast Ragavan from the command zone', targets: [] }
      ] : oracleFlow ? [
        { id: 'pass', text: 'Pass priority', targets: [] },
        { id: 'ability-77-0', text: 'Play Forest from the top of your library', targets: [] },
        { id: 'ability-78-0', text: 'Cast Lightning Bolt from the top of the library', targets: [] }
      ] : combatFlow ? [
        { id: 'combat-attackers-commit', text: 'Attack with no creatures', targets: [] },
        { id: 'combat-attack-add-74-player-1', text: 'words are presentation only', targets: [{ oid: 'forge-card-74', name: 'Savannah Lions' }] },
        ...(behavior === 'combat-defenders' ? [
          { id: 'combat-attack-add-74-card-90', text: 'words are presentation only', targets: [{ oid: 'forge-card-74', name: 'Savannah Lions' }] }
        ] : []),
        ...(behavior === 'combat-ambiguous' ? [
          { id: 'combat-attack-add-74-later', text: 'words are presentation only', targets: [{ oid: 'forge-card-74', name: 'Savannah Lions' }] }
        ] : [])
      ] : manaUndoFlow ? [
        { id: 'pass', text: 'Pass priority', targets: [] },
        { id: 'undo-mana', text: 'presentation may change', targets: [] }
      ] : manaFlow ? [
        { id: 'mana-source-75-0-G', text: 'words are presentation only', targets: [{ oid: 'forge-card-75', name: 'Forest' }] }
      ] : [{ id: 'pass', text: 'Pass priority', targets: [] }],
      input: null,
      complete: true
    } : playerTargetFlow ? {
      seat: 0,
      kind: 'target-selection',
      prompt: 'Select target player',
      options: [
        { id: 'target-player-0', text: 'Target Human', targets: [] },
        { id: 'target-player-1', text: 'Target Forge AI', targets: [] },
        { id: 'target-cancel', text: 'Cancel casting Lava Axe', targets: [] }
      ],
      input: null,
      complete: true
    } : handToLibraryFlow ? {
      seat: 0,
      kind: 'zone-card-selection-hand-to-library',
      prompt: 'presentation only',
      options: [
        { id: 'zone-card-selection-hand-to-library-card-71', text: 'presentation only', targets: [{ oid: 'forge-card-71', name: 'Island' }] },
        { id: 'zone-card-selection-hand-to-library-card-72', text: 'presentation only', targets: [{ oid: 'forge-card-72', name: 'Island' }] }
      ],
      input: null,
      complete: true
    } : zoneFlow ? {
      seat: 0,
      kind: 'zone-card-selection',
      prompt: 'Search your library',
      options: zoneOptions,
      input: null,
      complete: true
    } : discardFlow ? {
      seat: 0,
      kind: 'hand-card-selection',
      prompt: 'Choose a card to discard',
      options: discardOptions,
      input: null,
      complete: true
    } : colorFlow ? {
      seat: 0,
      kind: 'color-choice',
      prompt: 'Choose a color',
      options: colorOptions,
      input: null,
      complete: true
    } : parityFlow ? {
      seat: 0,
      kind: 'parity-choice',
      prompt: 'Choose odd or even',
      options: parityOptions,
      input: null,
      complete: true
    } : {
      seat: 0,
      kind: 'target-selection',
      prompt: 'Select target permanent',
      options: behavior === 'bad-target' ? [{ id: 'target-card-41', text: 'Target Mountain', targets: [{ oid: '', name: 'Mountain' }] }] : targetOptions,
      input: null,
      complete: true
    },
    result: finished ? { winner: 0, reason: 'test outcome', endedOnTurn: 1 } : null
  };
  if (combatFlow) {
    response.view.seats[1].battlefield = [
      { oid: 'forge-card-80', name: 'Grizzly Bears', typeLine: 'Creature — Bear', power: 2, toughness: 2, tapped: true, attacking: true, blockedBy: ['forge-card-74'], damage: 0, controller: 1, counters: {} }
    ];
  }
  if (oracleFlow) {
    response.view.seats[0].libraryTop = [{ oid: 'forge-card-77', name: 'Forest', typeLine: 'Basic Land — Forest', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 0, counters: {} }];
    response.view.seats[1].libraryTop = [{ oid: 'forge-card-78', name: 'Lightning Bolt', typeLine: 'Instant', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: 1, counters: {} }];
  }
  if (commanderFlow) {
    const commanders = ['Ragavan, Nimble Pilferer', 'Thalia, Guardian of Thraben'];
    response.view.seats.forEach((seat, index) => {
      seat.commandZone = [{ oid: 'forge-card-' + (101 + index), name: commanders[index], typeLine: 'Legendary Creature', power: 2, toughness: 1, tapped: false, attacking: false, damage: 0, controller: index, counters: {} }];
      seat.commanderDamage = {};
      seat.commanderCasts = { ['forge-card-' + (101 + index)]: 0 };
    });
  }
  if (momirFlow) {
    response.view.seats.forEach((seat, index) => {
      seat.avatars = [{ oid: 'forge-card-' + (111 + index), name: 'Momir Vig, Simic Visionary Avatar', typeLine: 'Vanguard', power: null, toughness: null, tapped: false, attacking: false, damage: 0, controller: index, counters: {} }];
    });
  }
  return response;
}
const prefix = '@@MTG_FORGE_JSON@@';
function send(value) { process.stdout.write(prefix + JSON.stringify(value) + '\n'); }
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.type === 'hello') {
    if (behavior === 'malformed') return process.stdout.write(prefix + '{not json}\n');
    if (behavior === 'death') return process.exit(23);
    if (behavior === 'timeout') return;
    if (behavior === 'closed-stdin') {
      input.close();
      fs.closeSync(0);
      send({ protocolVersion, type: 'hello', requestId: request.requestId, forgeVersion: '2.0.14' });
      return setInterval(() => {}, 1000);
    }
    send({ protocolVersion, type: 'hello', requestId: request.requestId, forgeVersion: '2.0.14' });
    return;
  }
  if (request.type === 'open') {
    if (typeof request.format !== 'string' || request.format === ''
        || !['Constructed', 'Commander', 'MomirBasic'].includes(request.forgeGameType)
        || typeof request.startingLife !== 'number'
        || typeof request.engineCyclingLookahead !== 'boolean'
        || !request.seats.every(seat => Array.isArray(seat.commanders))) {
      return send({ protocolVersion, type: 'error', requestId: request.requestId, kind: 'backend-failure', message: 'wrong format mapping' });
    }
    if (behavior === 'commander' && JSON.stringify([request.forgeGameType, request.startingLife, request.seats.map(seat => seat.commanders)]) !== JSON.stringify([
      'Commander', 40, [[{ name: 'Ragavan, Nimble Pilferer', count: 1 }], [{ name: 'Thalia, Guardian of Thraben', count: 1 }]]
    ])) {
      return send({ protocolVersion, type: 'error', requestId: request.requestId, kind: 'backend-failure', message: 'wrong commander mapping' });
    }
    if (behavior === 'momir' && JSON.stringify([request.forgeGameType, request.startingLife]) !== JSON.stringify(['MomirBasic', 24])) {
      return send({ protocolVersion, type: 'error', requestId: request.requestId, kind: 'backend-failure', message: 'wrong Momir mapping' });
    }
    if (behavior !== 'commander' && behavior !== 'momir' && request.forgeGameType !== 'Constructed') {
      return send({ protocolVersion, type: 'error', requestId: request.requestId, kind: 'backend-failure', message: 'a standard table opened as ' + request.forgeGameType });
    }
    startingLife = request.startingLife;
    if (behavior === 'sideboard' && JSON.stringify(request.seats.map(seat => seat.sideboard)) !== JSON.stringify([
      [{ name: 'Mountain', count: 1 }],
      []
    ])) {
      return send({ protocolVersion, type: 'error', requestId: request.requestId, kind: 'backend-failure', message: 'wrong sideboard mapping' });
    }
    return send(snapshot(request.requestId));
  }
  if (request.type === 'submit') { revision += 1; return send(snapshot(request.requestId)); }
  if (request.type === 'close') {
    if (process.env.CLOSE_LOG) fs.appendFileSync(process.env.CLOSE_LOG, 'close\n');
    send({ protocolVersion, type: 'closed', requestId: request.requestId });
    return process.exit(0);
  }
});
`;

function backend(behavior = 'normal', closeLog?: string) {
  return forgeObservedBackend({
    command: process.execPath,
    args: ['-e', CHILD],
    cwd: process.cwd(),
    timeoutMs: 1_000,
    env: {
      ...process.env,
      BEHAVIOR: behavior,
      ...(closeLog === undefined ? {} : { CLOSE_LOG: closeLog }),
    },
  });
}

describe('Forge observed backend process contract', () => {
  it('opens an explicitly scoped catalog-discovery session without widening ordinary admission', async () => {
    const deck = { name: 'foreign', cards: [{ name: 'Lightning Bolt', count: 60 }] };
    const table: SessionSpec = {
      ...TABLE,
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        { ...TABLE.seats[0], deck },
        { ...TABLE.seats[1], deck },
      ],
    };
    const ordinary = backend();
    expect(await ordinary.supports(table)).toContain(
      'printed card "Lightning Bolt" is outside the audited Forge decision-family slice',
    );
    await ordinary.shutdown?.();

    const diagnostic = forgeObservedDiagnosticBackend(
      {
        command: process.execPath,
        args: ['-e', CHILD],
        cwd: process.cwd(),
        timeoutMs: 1_000,
        env: { ...process.env, BEHAVIOR: 'diagnostic' },
      },
      new Set(['Lightning Bolt']),
    );
    expect(await diagnostic.supports(table)).toEqual([]);
    const opened = await diagnostic.open(table);
    if (!opened.ok) throw new Error(opened.error.message);
    expect(opened.session.backend).toContain('diagnostic');
    const advanced = await opened.session.submit('pass');
    if (!advanced.ok) throw new Error(advanced.error.message);
    expect(advanced.session.transcript).toHaveLength(1);
    expect(advanced.session.transcript[0]?.seq).toBe(1);
    await advanced.session.close();
    await diagnostic.shutdown?.();
  });

  it('keeps catalog discovery confined to the explicitly supplied card inventory', async () => {
    const options = {
      command: process.execPath,
      args: ['-e', CHILD],
      cwd: process.cwd(),
      timeoutMs: 1_000,
    };
    expect(() => forgeObservedDiagnosticBackend(options, new Set())).toThrow(/non-empty/u);
    const diagnostic = forgeObservedDiagnosticBackend(options, new Set(['Mountain']));
    const foreign: SessionSpec = {
      ...TABLE,
      content: { kind: 'printed' as const, format: 'akh-hou' },
      seats: [
        { ...TABLE.seats[0], deck: { name: 'foreign', cards: [{ name: 'Lightning Bolt', count: 60 }] } },
        TABLE.seats[1],
      ],
    };
    expect(await diagnostic.supports(foreign)).toContain(
      'printed card "Lightning Bolt" is outside the diagnostic catalog inventory',
    );
    await diagnostic.shutdown?.();
  });

  it('opens a separately identified admitted-format session through its verified card inventory', async () => {
    const deck = { name: 'admitted', cards: [{ name: 'Lightning Bolt', count: 60 }] };
    const table: SessionSpec = {
      ...TABLE,
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        { ...TABLE.seats[0], deck },
        { ...TABLE.seats[1], deck },
      ],
    };
    const admitted = forgeObservedAdmittedBackend(
      {
        command: process.execPath,
        args: ['-e', CHILD],
        cwd: process.cwd(),
        timeoutMs: 1_000,
        env: { ...process.env, BEHAVIOR: 'admitted' },
      },
      new Set(['Lightning Bolt']),
    );
    expect(admitted.id).toContain('admitted');
    expect(await admitted.supports(table)).toEqual([]);
    const opened = await admitted.open(table);
    if (!opened.ok) throw new Error(opened.error.message);
    await opened.session.close();
    await admitted.shutdown?.();
  });

  it('requires an explicit global-creature policy for admitted Momir sessions', async () => {
    const basics = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
    const refused = forgeObservedAdmittedBackend(
      {
        command: process.execPath,
        args: ['-e', CHILD],
        cwd: process.cwd(),
        timeoutMs: 1_000,
        env: { ...process.env, BEHAVIOR: 'momir' },
      },
      basics,
    );
    expect(await refused.supports(MOMIR_TABLE)).toContain(
      'Momir Basic requires the admitted Forge global-creature policy',
    );
    await refused.shutdown?.();
    const admitted = forgeObservedAdmittedBackend(
      {
        command: process.execPath,
        args: ['-e', CHILD],
        cwd: process.cwd(),
        timeoutMs: 1_000,
        env: { ...process.env, BEHAVIOR: 'momir' },
      },
      basics,
      'forge-momir-global-creatures',
    );
    expect(await admitted.supports(MOMIR_TABLE)).toEqual([]);
    const standard = { ...MOMIR_TABLE, rules: { variant: 'standard' as const, startingLife: 20 } };
    expect(await admitted.supports(standard)).toContain(
      'The Forge global-creature policy is restricted to Momir Basic',
    );
    await admitted.shutdown?.();
  });

  it.each([
    'Manalith',
    'Adorned Pouncer',
    'Defiant Khenra',
    'Those Who Serve',
    'Ancient Crab',
    'Dune Beetle',
    'Hyena Pack',
    'Colossapede',
    'Dutiful Servants',
    'Harrier Naga',
    'Shefet Monitor',
    'Desert of the Indomitable',
    'Khenra Eternal',
  ])('keeps provisional %s independent from Cube admission', async (name) => {
    const deck = {
      name: 'pouncer',
      cards: [
        { name: 'Plains', count: 30 },
        { name, count: 30 },
      ],
    };
    const spec: SessionSpec = {
      ...TABLE,
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        { ...TABLE.seats[0], deck },
        { ...TABLE.seats[1], deck },
      ],
    };
    expect(await backend().supports(spec)).toEqual([]);
    const foreign: SessionSpec = {
      ...spec,
      seats: [
        {
          ...spec.seats[0],
          deck: {
            name: 'cube-only',
            cards: [{ name: 'Lightning Bolt', count: 60 }],
          },
        },
        spec.seats[1],
      ],
    };
    expect(await backend().supports(foreign)).toContain(
      'printed card "Lightning Bolt" is outside the audited Forge decision-family slice',
    );
    expect(
      await backend().supports({ ...spec, content: { kind: 'printed', format: 'legacy-cube-2021-08' } }),
    ).toContain(`printed card "${name}" is outside the audited Forge decision-family slice`);
  });
  it('accepts two local seats when both Forge controllers must expose decisions', async () => {
    const localTable: SessionSpec = {
      ...TABLE,
      seats: [TABLE.seats[0], { ...TABLE.seats[1], controller: 'local' }],
    };
    expect(await backend().supports(localTable)).toEqual([]);
  });

  it('declares per-seat projection and projects a two-local table so neither seat is sent the other hand', async () => {
    const forge = backend('discard');
    expect(forge.capabilities.perSeatProjection).toBe(true);
    const opened = await forge.open({
      ...TABLE,
      seats: [TABLE.seats[0], { ...TABLE.seats[1], controller: 'local' }],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const seats = opened.session.seats;
    expect(seats).not.toBeNull();
    if (seats === null) return;
    expect(opened.session.view.seats[0].hand).toHaveLength(2);
    expect(seats.view(0).seats[0].hand).toHaveLength(2);
    expect(seats.view(0).seats[1].hand).toBeNull();
    expect(seats.view(1).seats[0].hand).toBeNull();
    expect(seats.view(1).seats[0].handSize).toBe(2);
    expect(seats.decision(0)).toEqual(opened.session.decision);
    expect(seats.decision(1)).toBeNull();
    await opened.session.close();
  });

  it('judges an unfamiliar printed format by its cards, not by its name', async () => {
    const unfamiliar = { ...TABLE, content: { kind: 'printed', format: 'Planechase' } } as const;
    expect(await backend().supports(unfamiliar)).toEqual([]);
  });

  it('refuses unaudited card families by deduplicated name before starting a child', async () => {
    const unsupported: SessionSpec = {
      ...TABLE,
      seats: [
        {
          ...TABLE.seats[0],
          deck: {
            name: 'unsupported-human',
            cards: [
              { name: 'Entomb', count: 4 },
              { name: 'Mountain', count: 20 },
              { name: 'Black Lotus', count: 1 },
            ],
          },
        },
        {
          ...TABLE.seats[1],
          deck: {
            name: 'unsupported-ai',
            cards: [
              { name: 'Black Lotus', count: 1 },
              { name: 'Flame Rift', count: 35 },
            ],
          },
        },
      ],
    };
    expect(await backend().supports(unsupported)).toEqual([
      'printed card "Black Lotus" is outside the audited Forge decision-family slice',
    ]);
    expect(await backend().open(unsupported)).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'unsupported', capability: 'printed-human-vs-engine' }),
    });
  });

  it('handshakes, opens a neutral session, and advances it by backend-issued move id', async () => {
    const opened = await backend().open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.backend).toBe('forge');
    expect(opened.session.determinism).toBe('observed');
    expect(opened.session.decision?.options.map((option) => option.id)).toEqual(['pass']);
    expect(opened.session.play).toEqual({
      turnStep: 'precombatMain',
      passPriority: 'pass',
      concede: null,
      objectActions: [],
      seatActions: [],
      promptRole: null,
      automatic: null,
    });

    const advanced = await opened.session.submit('pass');
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.session.status).toBe('finished');
    expect(advanced.session.result).toEqual({ winner: 0, reason: 'test outcome', endedOnTurn: 1 });
    expect(advanced.session.transcript).toHaveLength(2);
    await advanced.session.close();
  });

  it('normalizes an exact Forge host-card action into the neutral object role', async () => {
    const opened = await backend('ability').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play).toEqual({
      turnStep: 'precombatMain',
      passPriority: 'pass',
      concede: 'concede',
      objectActions: [{ oid: 'forge-card-73', move: 'ability-73-0', category: 'play' }],
      seatActions: [],
      promptRole: null,
      automatic: null,
    });
    await opened.session.close();
  });

  it('declares an exact hand spell as a cast rather than leaving it in the generic action bucket', async () => {
    const opened = await backend('spell').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play?.objectActions).toEqual([
      { oid: 'forge-card-76', move: 'ability-76-0', category: 'cast' },
    ]);
    await opened.session.close();
  });

  it('declares the local starting-player move as routine setup without exposing Forge ids to the browser', async () => {
    const opened = await backend('starting-player').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play?.automatic).toEqual({
      move: 'pregame-start-seat-0',
      reason: 'local-starts',
    });
    await opened.session.close();
  });

  it('declares the opening-hand prompt so the shared flyout opens immediately', async () => {
    const opened = await backend('mulligan').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play?.promptRole).toBe('opening-hand');
    expect(opened.session.play?.automatic).toBeNull();
    await opened.session.close();
  });

  it('declares one exact ordinary mana source as routine payment while preserving cancel', async () => {
    const opened = await backend('mana-payment').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play?.automatic).toEqual({
      move: 'mana-source-75-0-G',
      reason: 'mana-payment',
    });
    await opened.session.close();
  });

  it('continues an exact Phyrexian life payment when Forge omits unpaid metadata', async () => {
    const opened = await backend('phyrexian-payment').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play?.automatic).toEqual({
      move: 'mana-payment-phyrexian-life',
      reason: 'mana-payment',
    });
    await opened.session.close();
  });

  it('leaves competing mana and Phyrexian life payments to the player', async () => {
    const opened = await backend('phyrexian-choice').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play?.automatic).toBeNull();
    await opened.session.close();
  });

  it('plans across physical mana sources before declaring the next automatic payment', async () => {
    const opened = await backend('mana-plan').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play?.automatic).toEqual({
      move: 'mana-source-46-0-B',
      reason: 'mana-payment',
    });
    await opened.session.close();
  });

  it('normalizes an exact Forge combat source without asking the browser to parse its move id', async () => {
    const opened = await backend('combat').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    // The bridge writes a block once, on the attacker, and only where there is
    // one: the strict companion carries the list through and adds nothing to
    // an unblocked creature.
    expect(opened.session.view.seats[1].battlefield[0]?.blockedBy).toEqual(['forge-card-74']);
    expect(opened.session.view.seats[0].battlefield[0]).not.toHaveProperty('blockedBy');
    expect(opened.session.play).toEqual({
      turnStep: 'declareAttackers',
      passPriority: null,
      concede: null,
      objectActions: [
        {
          oid: 'forge-card-74',
          move: 'combat-attack-add-74-player-1',
          category: 'combat',
          defender: { seat: 1 },
        },
      ],
      seatActions: [],
      attackers: { confirm: 'combat-attackers-commit', staged: [] },
      promptRole: null,
      automatic: null,
    });
    await opened.session.close();
  });

  it('names who each offered attack goes at, so one creature offered at a player and a planeswalker is a declaration', async () => {
    const opened = await backend('combat-defenders').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play?.objectActions).toEqual([
      {
        oid: 'forge-card-74',
        move: 'combat-attack-add-74-player-1',
        category: 'combat',
        defender: { seat: 1 },
      },
      {
        oid: 'forge-card-74',
        move: 'combat-attack-add-74-card-90',
        category: 'combat',
        defender: { oid: 'forge-card-90' },
      },
    ]);
    expect(opened.session.play?.attackers).toEqual({ confirm: 'combat-attackers-commit', staged: [] });
    await opened.session.close();
  });

  it('withholds the attackers role when one creature is offered twice and the offers do not say who they attack', async () => {
    const opened = await backend('combat-ambiguous').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play?.attackers).toBeUndefined();
    // The moves themselves stay declared: only the click-to-stage role is refused.
    expect(opened.session.play?.objectActions?.map((action) => action.move)).toEqual([
      'combat-attack-add-74-player-1',
      'combat-attack-add-74-later',
    ]);
    await opened.session.close();
  });

  it('normalizes an exact Forge mana source without asking the browser to parse its move id', async () => {
    const opened = await backend('mana').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play).toEqual({
      turnStep: 'precombatMain',
      passPriority: null,
      concede: null,
      objectActions: [
        { oid: 'forge-card-75', move: 'mana-source-75-0-G', category: 'mana', manaOutput: 'G' },
      ],
      seatActions: [],
      promptRole: null,
      automatic: null,
    });
    await opened.session.close();
  });

  it('normalizes an offered Forge mana take-back into the shared undo role', async () => {
    const opened = await backend('mana-undo').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.session.play?.undo).toBe('undo-mana');
    expect(opened.session.play?.manaPools?.[0]).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 });
    await opened.session.close();
  });

  it('normalizes exact Forge player targets into neutral seat roles at the adapter boundary', async () => {
    const opened = await backend('player-target').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const targeting = await opened.session.submit('pass');
    expect(targeting.ok).toBe(true);
    if (!targeting.ok) return;

    expect(targeting.session.play?.seatActions).toEqual([
      { seat: 0, move: 'target-player-0' },
      { seat: 1, move: 'target-player-1' },
    ]);
    await targeting.session.close();
  });

  it('carries the declared sideboard to the Forge process without changing the main deck', async () => {
    const table: SessionSpec = {
      ...TABLE,
      seats: [
        {
          ...TABLE.seats[0],
          deck: {
            ...TABLE.seats[0].deck,
            sideboard: [{ name: 'Mountain', count: 1 }],
          },
        },
        TABLE.seats[1],
      ],
    };
    const opened = await backend('sideboard').open(table);
    expect(opened.ok).toBe(true);
    if (opened.ok) await opened.session.close();
  });

  it("opens a commander table under Forge's Commander game, with each seat's commander and starting life", async () => {
    const opened = await backend('commander').open(COMMANDER_TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.view.seats.map((seat) => seat.life)).toEqual([40, 40]);
    expect(opened.session.view.seats.map((seat) => seat.commandZone?.map((card) => card.name))).toEqual([
      ['Ragavan, Nimble Pilferer'],
      ['Thalia, Guardian of Thraben'],
    ]);
    expect(opened.session.view.seats.map((seat) => seat.commanderDamage)).toEqual([{}, {}]);
    expect(opened.session.view.seats.map((seat) => seat.commanderCasts)).toEqual([
      { 'forge-card-101': 0 },
      { 'forge-card-102': 0 },
    ]);
    // The commander is castable from the command zone (CR 903.8), and the
    // bridge offers that through the same ability family as a hand cast, so
    // the object role names it a cast on the command-zone object.
    expect(opened.session.play?.objectActions).toEqual([
      { oid: 'forge-card-101', move: 'ability-101-0', category: 'cast' },
    ]);
    await opened.session.close();
  });

  it("opens a Momir table under Forge's Momir Basic game and binds the avatar ability", async () => {
    const opened = await backend('momir').open(MOMIR_TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.view.seats.map((seat) => seat.life)).toEqual([24, 24]);
    expect(opened.session.view.seats.map((seat) => seat.avatars?.map((card) => card.name))).toEqual([
      ['Momir Vig, Simic Visionary Avatar'],
      ['Momir Vig, Simic Visionary Avatar'],
    ]);
    expect(opened.session.play?.objectActions).toEqual([
      { oid: 'forge-card-111', move: 'ability-111-0', category: 'ability' },
    ]);
    await opened.session.close();
  });

  it('carries a public top card of the library and declares its land play and cast the way it does a held card', async () => {
    // Oracle of Mul Daya: the bridge names the top card while every player may
    // look at it, and offers the play through the same ability family as a
    // hand play. The card is in nobody's hand, so without the field the action
    // would be dropped as an action on an object the seat cannot see.
    const opened = await backend('oracle').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.view.seats.map((seat) => seat.libraryTop?.map((card) => card.name))).toEqual([
      ['Forest'],
      ['Lightning Bolt'],
    ]);
    expect(opened.session.play?.objectActions).toEqual([
      { oid: 'forge-card-77', move: 'ability-77-0', category: 'play' },
      { oid: 'forge-card-78', move: 'ability-78-0', category: 'cast' },
    ]);
    await opened.session.close();
  });

  it('opens the standard game as Constructed, with no command zone on either seat', async () => {
    const opened = await backend().open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.view.seats.map((seat) => seat.life)).toEqual([20, 20]);
    for (const seat of opened.session.view.seats) {
      expect(seat).not.toHaveProperty('commandZone');
      expect(seat).not.toHaveProperty('commanderDamage');
      expect(seat).not.toHaveProperty('commanderCasts');
      expect(seat).not.toHaveProperty('libraryTop');
    }
    await opened.session.close();
  });

  it('refuses a table whose rules and decks disagree, or whose commander is unaudited, before reaching Forge', async () => {
    const forge = backend();
    const [ragavan, thalia] = COMMANDER_TABLE.seats;
    const { commanders: _dropped, ...noCommander } = ragavan.deck;
    expect(
      await forge.supports({ ...COMMANDER_TABLE, seats: [{ ...ragavan, deck: noCommander }, thalia] }),
    ).toContain('seat 0 (Human) names no commander, and a commander table seats no deck without one');
    expect(
      await forge.supports({
        ...TABLE,
        seats: [
          {
            ...TABLE.seats[0],
            deck: { ...TABLE.seats[0].deck, commanders: [{ name: 'Ragavan, Nimble Pilferer', count: 1 }] },
          },
          thalia,
        ],
      }),
    ).toContain('seat 0 (Human) names a commander, and the standard game has no command zone to put it in');
    expect(
      await forge.supports({
        ...COMMANDER_TABLE,
        seats: [
          {
            ...ragavan,
            deck: { ...ragavan.deck, commanders: [{ name: 'Felothar the Steadfast', count: 1 }] },
          },
          thalia,
        ],
      }),
    ).toContain('printed card "Felothar the Steadfast" is outside the audited Forge decision-family slice');
    expect(await forge.supports(COMMANDER_TABLE)).toEqual([]);
    await forge.shutdown?.();
  });

  it('preserves successive complete target decisions and exact duplicate-name object identities', async () => {
    const opened = await backend('target').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const targeted = await opened.session.submit('pass');
    expect(targeted.ok).toBe(true);
    if (!targeted.ok) return;
    expect(targeted.session.decision).toMatchObject({
      kind: 'target-selection',
      complete: true,
      options: [
        { id: 'target-card-41', targets: [{ oid: 'forge-card-41', name: 'Mountain' }] },
        { id: 'target-card-42', targets: [{ oid: 'forge-card-42', name: 'Mountain' }] },
        { id: 'target-cancel', targets: [] },
      ],
    });
    expect(await targeted.session.submit('invented-target')).toMatchObject({
      ok: false,
      error: { kind: 'unknown-move' },
    });
    const resolved = await targeted.session.submit('target-card-42');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) await resolved.session.close();
  });

  it('rejects a malformed target annotation at the strict companion boundary', async () => {
    const opened = await backend('bad-target').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const malformed = await opened.session.submit('pass');
    expect(malformed).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'backend-failure' }),
    });
    await opened.session.close();
  });

  it('preserves a complete hidden-zone choice without exposing it through the table projection', async () => {
    const opened = await backend('zone').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const choosing = await opened.session.submit('pass');
    expect(choosing.ok).toBe(true);
    if (!choosing.ok) return;
    expect(choosing.session.view.seats[0].librarySize).toBe(60);
    expect(choosing.session.decision).toMatchObject({
      kind: 'zone-card-selection',
      complete: true,
      options: [
        { id: 'zone-card-61', targets: [{ oid: 'forge-card-61', name: 'Farseek' }] },
        { id: 'zone-card-62', targets: [{ oid: 'forge-card-62', name: 'Farseek' }] },
        { id: 'zone-decline', targets: [] },
      ],
    });
    expect(await choosing.session.submit('invented-zone-card')).toMatchObject({
      ok: false,
      error: { kind: 'unknown-move' },
    });
    const resolved = await choosing.session.submit('zone-card-62');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) await resolved.session.close();
  });

  it('projects a proved hand-to-library selection route without interpreting its prompt', async () => {
    const opened = await backend('hand-to-library').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const choosing = await opened.session.submit('pass');
    expect(choosing.ok).toBe(true);
    if (!choosing.ok) return;
    expect(choosing.session.play?.cardSelection).toEqual({ origin: 'hand', destination: 'library' });
    await choosing.session.close();
  });

  it('preserves exact same-name local-hand discard identities without revealing the opposing hand', async () => {
    const opened = await backend('discard').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const choosing = await opened.session.submit('pass');
    expect(choosing.ok).toBe(true);
    if (!choosing.ok) return;
    expect(choosing.session.view.seats[0].hand?.map((card) => card.oid)).toEqual([
      'forge-card-71',
      'forge-card-72',
    ]);
    expect(choosing.session.view.seats[1].hand).toBeNull();
    expect(choosing.session.decision).toMatchObject({
      kind: 'hand-card-selection',
      complete: true,
      options: [
        { id: 'discard-card-71', targets: [{ oid: 'forge-card-71', name: 'Island' }] },
        { id: 'discard-card-72', targets: [{ oid: 'forge-card-72', name: 'Island' }] },
      ],
    });
    expect(await choosing.session.submit('discard-card-opponent')).toMatchObject({
      ok: false,
      error: { kind: 'unknown-move' },
    });
    const resolved = await choosing.session.submit('discard-card-72');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) await resolved.session.close();
  });

  it('preserves Coldsteel Heart exact five-color options and opaque selected identity', async () => {
    const opened = await backend('color').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const choosing = await opened.session.submit('pass');
    expect(choosing.ok).toBe(true);
    if (!choosing.ok) return;
    expect(choosing.session.decision).toMatchObject({
      kind: 'color-choice',
      complete: true,
      options: ['W', 'U', 'B', 'R', 'G'].map((symbol) => ({
        id: `color-choice-${symbol}`,
        targets: [{ oid: 'forge-card-81', name: 'Coldsteel Heart' }],
      })),
    });
    expect(await choosing.session.submit('color-choice-C')).toMatchObject({
      ok: false,
      error: { kind: 'unknown-move' },
    });
    const resolved = await choosing.session.submit('color-choice-R');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) await resolved.session.close();
  });

  it('preserves Extinction Event exact odd-even options and opaque selected identity', async () => {
    const opened = await backend('parity').open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const choosing = await opened.session.submit('pass');
    expect(choosing.ok).toBe(true);
    if (!choosing.ok) return;
    expect(choosing.session.decision).toMatchObject({
      kind: 'parity-choice',
      complete: true,
      options: ['odd', 'even'].map((parity) => ({
        id: `parity-choice-${parity}`,
        targets: [{ oid: 'forge-card-91', name: 'Extinction Event' }],
      })),
    });
    expect(await choosing.session.submit('parity-choice-neither')).toMatchObject({
      ok: false,
      error: { kind: 'unknown-move' },
    });
    const resolved = await choosing.session.submit('parity-choice-even');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) await resolved.session.close();
  });

  it('refuses a protocol version mismatch and reaps the child', async () => {
    const opened = await backend('version').open(TABLE);
    expect(opened).toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: 'backend-failure',
        message: expect.stringContaining('version'),
      }),
    });
  });

  it('maps malformed output to backend-failure', async () => {
    const opened = await backend('malformed').open(TABLE);
    expect(opened).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'backend-failure', message: expect.stringContaining('JSON') }),
    });
  });

  it('maps child death to backend-failure with the exit code', async () => {
    const opened = await backend('death').open(TABLE);
    expect(opened).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'backend-failure', message: expect.stringContaining('23') }),
    });
  });

  it('maps a child that closes stdin to backend-failure without an unhandled EPIPE', async () => {
    const opened = await backend('closed-stdin').open(TABLE);
    expect(opened).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'backend-failure', message: expect.stringContaining('stdin') }),
    });
  });

  it('bounds a silent child and reports the exact timeout', async () => {
    const opened = await backend('timeout').open(TABLE);
    expect(opened).toEqual({
      ok: false,
      error: { kind: 'timeout', message: expect.stringContaining('1000 ms'), millis: 1_000 },
    });
  });

  it('refuses an unknown move before writing it to Forge', async () => {
    const opened = await backend().open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(await opened.session.submit('invented')).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'unknown-move', offered: 1 }),
    });
    await opened.session.close();
  });

  it('refuses a stale immutable snapshot after a newer one has advanced the process', async () => {
    const opened = await backend().open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const advanced = await opened.session.submit('pass');
    expect(advanced.ok).toBe(true);
    expect(await opened.session.submit('pass')).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'backend-failure', message: expect.stringContaining('stale') }),
    });
    await opened.session.close();
  });

  it('closes the subprocess exactly once', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-forge-close-'));
    const closeLog = join(directory, 'close.log');
    const opened = await backend('normal', closeLog).open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await Promise.all([opened.session.close(), opened.session.close()]);
    expect(readFileSync(closeLog, 'utf8')).toBe('close\n');
    expect(() => execFileSync('test', ['-e', closeLog])).not.toThrow();
  });
});
