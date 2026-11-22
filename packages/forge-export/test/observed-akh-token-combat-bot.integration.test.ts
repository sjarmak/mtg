/** Copied token abilities must function in native-bot combat, not only render. */
import { expect, it } from 'vitest';
import type { ObservedSession, PendingDecision, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function driverMove(
  decision: PendingDecision,
  name: string,
  embalm: boolean,
  canCast: boolean,
  tokenCreated: boolean,
): string | undefined {
  if (decision.kind === 'priority') {
    return (
      decision.options.find((option) => option.text === 'Play Plains')?.id ??
      (canCast && !tokenCreated
        ? decision.options.find(
            (option) =>
              option.text.startsWith(`${name}:`) && !option.text.includes(embalm ? 'Embalm' : 'Eternalize'),
          )?.id
        : undefined) ??
      decision.options.find((option) => option.text === 'Pass priority')?.id
    );
  }
  if (decision.kind === 'mana-payment')
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  if (decision.kind === 'combat-attackers')
    return (
      (!embalm && !tokenCreated
        ? decision.options.find((option) => option.id.startsWith('combat-attack-add-'))?.id
        : undefined) ?? decision.options.find((option) => option.id === 'combat-attackers-commit')?.id
    );
  if (decision.kind === 'combat-blockers')
    return (
      (embalm && !tokenCreated
        ? decision.options.find((option) => option.id.startsWith('combat-block-add-'))?.id
        : undefined) ?? decision.options.find((option) => option.id === 'combat-blockers-commit')?.id
    );
  if (decision.kind === 'discard-selection')
    return (
      decision.options.find((option) => option.targets.some((target) => target.name === name))?.id ??
      decision.options.find((option) => option.targets.some((target) => target.name === 'Plains'))?.id
    );
  return decision.options.find((option) => ['Play first', 'Keep this hand'].includes(option.text))?.id;
}

forgeIt.each([
  { name: 'Adorned Pouncer', embalm: false, power: 4, seed: 'akh-hou-pouncer-engine-v1' },
  { name: 'Sacred Cat', embalm: true, power: 1, seed: 'akh-hou-sacred-cat-engine-v1' },
])(
  'Forge $name token retains its copied combat ability after graveyard activation',
  async ({ name, embalm, power, seed }) => {
    const deck = {
      name: 'graveyard-token-combat',
      cards: [
        { name: 'Plains', count: 30 },
        { name, count: 30 },
      ],
    };
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        { name: 'Local combat driver', controller: 'local', deck },
        { name: 'Native token pilot', controller: 'engine', deck },
      ],
      seed,
      maximumTurns: 40,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let seenOrdinary: readonly string[] = [];
    let seenGraveyard: readonly string[] = [];
    let tokenOid: string | undefined;
    let combat:
      | { turn: number; localLife: number; botLife: number; damage: number; attackers: readonly string[] }
      | undefined;
    let firstStrike = false;
    let finished = false;
    let trace: readonly string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2200; index += 1) {
        const decision = session.decision;
        if (decision !== null) expect(decision.seat).toBe(0);
        const local = session.view.seats[0];
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        seenOrdinary = [
          ...new Set([
            ...seenOrdinary,
            ...bot.battlefield
              .filter((card) => card.name === name && !card.typeLine.includes('Zombie'))
              .map((card) => card.oid),
          ]),
        ];
        seenGraveyard = [
          ...new Set([
            ...seenGraveyard,
            ...bot.graveyard.filter((card) => seenOrdinary.includes(card.oid)).map((card) => card.oid),
          ]),
        ];
        if (tokenOid === undefined) {
          const token = bot.battlefield.find(
            (card) => card.name === name && card.typeLine.includes('Zombie'),
          );
          if (token !== undefined) {
            expect(token).toMatchObject({ power, toughness: power, controller: 1 });
            expect(token).toMatchObject({
              characteristics: { colors: [embalm ? 'W' : 'B'], manaCost: null, token: true },
            });
            expect(token.typeLine).toContain('Cat');
            expect(seenOrdinary).not.toContain(token.oid);
            expect(bot.exile.some((card) => seenGraveyard.includes(card.oid))).toBe(true);
            tokenOid = token.oid;
          }
        }
        if (combat === undefined && tokenOid !== undefined && decision?.kind === 'combat-blockers') {
          const attackers = bot.battlefield.filter((card) => card.attacking);
          if (attackers.some((card) => card.oid === tokenOid)) {
            expect(session.view.turn.active).toBe(1);
            expect(session.view.stack).toHaveLength(0);
            for (const card of attackers) {
              expect(card.name).toBe(name);
              expect(card.power).toBe(card.typeLine.includes('Zombie') ? power : 1);
            }
            combat = {
              turn: session.view.turn.number,
              localLife: local.life,
              botLife: bot.life,
              damage: attackers.reduce((total, card) => total + (card.power ?? 0), 0),
              attackers: attackers.map((card) => card.oid),
            };
          }
        }
        if (combat !== undefined) {
          expect(session.view.turn.number).toBe(combat.turn);
          if (!embalm && local.life === combat.localLife - combat.damage) {
            expect(bot.life).toBe(combat.botLife);
            firstStrike = true;
          }
          const multiplier = embalm ? 1 : 2;
          if (local.life === combat.localLife - multiplier * combat.damage) {
            expect(bot.life).toBe(combat.botLife + (embalm ? combat.damage : 0));
            if (!embalm) expect(firstStrike).toBe(true);
            for (const oid of combat.attackers)
              expect(bot.battlefield.some((card) => card.oid === oid)).toBe(true);
            finished = true;
            break;
          }
        }
        if (session.status !== 'awaiting') break;
        if (decision === null) throw new Error('Missing decision');
        trace = [
          ...trace.slice(-19),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} life ${local.life}/${bot.life}: ${decision.options.map((option) => option.text).join(' | ')}`,
        ];
        const canCast = !embalm || local.battlefield.filter((card) => card.name === name).length < 2;
        const move = driverMove(decision, name, embalm, canCast, tokenOid !== undefined);
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }
      expect(finished, trace.join('\n')).toBe(true);
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  180_000,
);
