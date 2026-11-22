/** A blocker targeted by native exert regains legality at the next combat. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const CRASHER = 'Ahn-Crop Crasher';
const ATTACKER = 'Defiant Khenra';
const BLOCKERS = ['Adorned Pouncer', 'Sacred Cat'] as const;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Local blocker',
      controller: 'local',
      deck: {
        name: 'blockers',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Adorned Pouncer', count: 15 },
          { name: 'Sacred Cat', count: 15 },
        ],
      },
    },
    {
      name: 'Forge exert pilot',
      controller: 'engine',
      deck: {
        name: 'attackers',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: ATTACKER, count: 25 },
          { name: CRASHER, count: 5 },
        ],
      },
    },
  ],
  seed: 'akh-hou-exert-engine-v1',
  maximumTurns: 24,
};

forgeIt(
  'Forge Crasher restriction expires for the exact blocker by the next defensive combat',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let pendingExert: { readonly sourceOid: string; readonly turn: number } | undefined;
    let exertedSources: Readonly<Record<number, readonly string[]>> = {};
    let exerted:
      | {
          readonly sourceOid: string;
          readonly targetOid: string;
          readonly turn: number;
        }
      | undefined;
    let expired = false;
    let trace: readonly string[] = [];
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const local = session.view.seats[0];
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        const blockers = local.battlefield.filter((card) => BLOCKERS.some((name) => name === card.name));
        const attackingCrasher = bot.battlefield.find(
          (card) =>
            card.name === CRASHER &&
            card.attacking &&
            session?.view.stack.some((stacked) => stacked.oid === card.oid),
        );
        if (attackingCrasher !== undefined) {
          const turn = session.view.turn.number;
          const sources = exertedSources[turn] ?? [];
          if (!sources.includes(attackingCrasher.oid))
            exertedSources = { ...exertedSources, [turn]: [...sources, attackingCrasher.oid] };
          pendingExert ??= { sourceOid: attackingCrasher.oid, turn };
        }
        trace = [
          ...trace.slice(-19),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        ];
        if (
          exerted === undefined &&
          pendingExert !== undefined &&
          session.view.turn.number === pendingExert.turn &&
          decision.kind === 'combat-blockers'
        ) {
          expect(blockers).toHaveLength(2);
          expect(blockers.map((card) => card.name).sort()).toEqual([...BLOCKERS].sort());
          expect(blockers.every((card) => !card.tapped)).toBe(true);
          expect(new Set(blockers.map((card) => card.oid)).size).toBe(2);
          const pendingSourceOid = pendingExert.sourceOid;
          const legal = blockers.filter((blocker) =>
            decision.options.some(
              (option) =>
                option.id.startsWith('combat-block-add-') &&
                option.targets.some((target) => target.oid === blocker.oid) &&
                option.targets.some((target) => target.oid === pendingSourceOid),
            ),
          );
          expect(legal).toHaveLength(1);
          const target = blockers.find((blocker) => blocker.oid !== legal[0]?.oid);
          expect(target).toBeDefined();
          exerted = {
            sourceOid: pendingExert.sourceOid,
            targetOid: target?.oid ?? '',
            turn: pendingExert.turn,
          };
        }
        const observed = exerted;
        if (
          observed !== undefined &&
          decision.kind === 'combat-blockers' &&
          session.view.turn.number === observed.turn + 2
        ) {
          expect(bot.battlefield.find((card) => card.oid === observed.sourceOid)?.attacking).toBe(false);
          expect(local.battlefield.find((card) => card.oid === observed.targetOid)).toMatchObject({
            tapped: false,
          });
          const ordinaryAttacker = bot.battlefield.find((card) => card.name === ATTACKER && card.attacking);
          expect(ordinaryAttacker).toBeDefined();
          expect(
            decision.options.some(
              (option) =>
                option.id.startsWith('combat-block-add-') &&
                option.targets.some((target) => target.oid === observed.targetOid) &&
                option.targets.some((target) => target.oid === ordinaryAttacker?.oid),
            ),
            trace.join('\n'),
          ).toBe(true);
          expired = true;
          break;
        }
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          for (const name of BLOCKERS)
            if (move === undefined && !blockers.some((card) => card.name === name))
              move = decision.options.find(
                (option) =>
                  option.text.startsWith(`${name}:`) &&
                  !option.text.includes('Embalm') &&
                  !option.text.includes('Eternalize'),
              )?.id;
          move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) =>
            option.targets.some((target) => BLOCKERS.some((name) => name === target.name)),
          )?.id;
        } else if (
          decision.kind === 'combat-blockers' &&
          !decision.options.some((option) => option.id.startsWith('combat-block-remove-'))
        ) {
          move = decision.options.find(
            (option) =>
              option.id.startsWith('combat-block-add-') &&
              option.targets.some((target) => target.name === 'Sacred Cat'),
          )?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled native expiry decision\n${trace.join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }
      expect(exerted, trace.join('\n')).toBeDefined();
      expect(expired, trace.join('\n')).toBe(true);
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
