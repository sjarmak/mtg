/** Exact Khenra combat trade after its separate Afflict life loss. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf, textSubmission } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Afflict attacker',
      controller: 'local',
      deck: {
        name: 'khenra-eternal',
        cards: [
          { name: 'Swamp', count: 20 },
          { name: 'Khenra Eternal', count: 20 },
        ],
      },
    },
    {
      name: 'Blocker pilot',
      controller: 'local',
      deck: {
        name: 'defiant-khenra',
        cards: [
          { name: 'Mountain', count: 20 },
          { name: 'Defiant Khenra', count: 20 },
        ],
      },
    },
  ],
  seed: 'hou-afflict-local-v1',
  maximumTurns: 20,
};

forgeIt(
  'Khenra Eternal trades with 1 exact blocker after Afflict and preserves the unblocked copy',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let source: string | undefined;
    let defendingCopies: readonly string[] = [];
    let attackTurn: number | undefined;
    let selectedBlockers: readonly string[] = [];
    let sawTrigger = false;
    let resolvedBeforeDamage = false;
    let completedCombat = false;
    let trace: readonly string[] = [];
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1000 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const attacker = session.view.seats[0];
        const defender = session.view.seats[1];
        const creature = attacker.battlefield.find((card) => card.oid === source);
        if (attackTurn !== undefined) {
          const triggers = session.view.stack.filter((card) => card.oid === source);
          if (triggers.length > 0) {
            expect(triggers).toHaveLength(1);
            expect(defender.life).toBe(20);
            sawTrigger = true;
          } else if (sawTrigger && !resolvedBeforeDamage) {
            expect(defender.life).toBe(19);
            expect(creature).toBeDefined();
            expect(defender.battlefield.filter((card) => selectedBlockers.includes(card.oid))).toHaveLength(
              1,
            );
            resolvedBeforeDamage = true;
          }
          if (session.view.turn.number === attackTurn && session.view.turn.step === 'MAIN2') {
            expect(defender.life).toBe(19);
            expect(attacker.life).toBe(20);
            expect(selectedBlockers).toHaveLength(1);
            expect(sawTrigger).toBe(true);
            expect(resolvedBeforeDamage).toBe(true);
            expect(attacker.graveyard.some((card) => card.oid === source)).toBe(true);
            const defeated = defender.graveyard.filter((card) => selectedBlockers.includes(card.oid));
            expect(defeated).toHaveLength(1);
            expect(defeated[0]).toMatchObject({ name: 'Defiant Khenra' });
            expect(defender.battlefield.filter((card) => selectedBlockers.includes(card.oid))).toEqual([]);
            expect(defender.battlefield.filter((card) => card.name === 'Defiant Khenra')).toHaveLength(1);
            for (const oid of defendingCopies.filter((oid) => !selectedBlockers.includes(oid)))
              expect(defender.battlefield.some((card) => card.oid === oid)).toBe(true);
            expect(attacker.battlefield.some((card) => card.oid === source)).toBe(false);
            completedCombat = true;
            break;
          }
        }
        trace = [
          ...trace.slice(-19),
          `${session.view.turn.number}/${session.view.turn.phase}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        ];
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const name = decision.seat === 0 ? 'Khenra Eternal' : 'Defiant Khenra';
          const land = decision.seat === 0 ? 'Swamp' : 'Mountain';
          const own = seatViewOf(session.view, decision.seat);
          move = decision.options.find((option) => option.text === `Play ${land}`)?.id;
          if (
            move === undefined &&
            attackTurn === undefined &&
            own.battlefield.filter((card) => card.name === name).length < (decision.seat === 0 ? 1 : 2)
          )
            move = decision.options.find((option) => option.text.startsWith(`${name}:`))?.id;
          move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'combat-attackers') {
          if (
            decision.seat === 0 &&
            attackTurn === undefined &&
            defender.battlefield.filter((card) => card.name === 'Defiant Khenra').length === 2
          ) {
            const attack = decision.options.find((option) => option.id.startsWith('combat-attack-add-'));
            move = attack?.id;
            source = attack?.targets[0]?.oid;
            if (source !== undefined) {
              attackTurn = session.view.turn.number;
              defendingCopies = defender.battlefield
                .filter((card) => card.name === 'Defiant Khenra')
                .map((card) => card.oid);
            }
          }
          move ??= 'combat-attackers-commit';
        } else if (decision.kind === 'combat-blockers') {
          if (decision.seat === 1 && attackTurn !== undefined && selectedBlockers.length < 1) {
            const block = decision.options.find(
              (option) =>
                option.id.startsWith('combat-block-add-') &&
                option.targets.some(
                  (card) => card.name === 'Defiant Khenra' && !selectedBlockers.includes(card.oid),
                ),
            );
            const blocker = block?.targets.find((card) => card.name === 'Defiant Khenra');
            if (blocker === undefined) throw new Error('Missing exact legal blocker');
            selectedBlockers = [...selectedBlockers, blocker.oid];
            move = block?.id;
          }
          move ??= 'combat-blockers-commit';
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'combat-damage') {
          const input = decision.input;
          const suggestion = input?.suggestions?.[0];
          if (input?.kind !== 'text' || suggestion === undefined) {
            throw new Error('combat damage did not expose a complete split');
          }
          move = textSubmission(input, suggestion);
        } else if (['combat-order-blockers', 'combat-order-attackers'].includes(decision.kind)) {
          move = decision.options[0]?.id;
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options[0]?.id;
        }
        move ??= decision.options.find((option) =>
          ['Play first', 'Keep this hand'].includes(option.text),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }
      expect(completedCombat, trace.join('\n')).toBe(true);
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
