/** Farm must target only combat creatures and destroy the chosen physical copy. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
for (const role of ['attacking', 'blocking'] as const) {
  forgeIt(
    `Farm destroys the selected ${role} creature and leaves other copies alone`,
    async () => {
      const table: SessionSpec = {
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Farm pilot',
            controller: 'local',
            deck: {
              name: 'farm',
              cards: [
                { name: 'Plains', count: 30 },
                { name: 'Farm // Market', count: 15 },
                { name: 'Sacred Cat', count: 15 },
              ],
            },
          },
          {
            name: 'Combat pilot',
            controller: 'local',
            deck: {
              name: 'creatures',
              cards: [
                { name: 'Mountain', count: 30 },
                { name: 'Defiant Khenra', count: 30 },
              ],
            },
          },
        ],
        seed: `akh-hou-farm-${role}-v1`,
        maximumTurns: 24,
      };
      const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      let session: ObservedSession | undefined;
      let cast = false;
      let source: string | undefined;
      let target: string | undefined;
      let survivors: readonly string[] = [];
      let noCombatChecked = false;
      let resolved = false;
      let rejectedInvalid = false;
      let rejectedStale = false;
      const combatants = new Set<string>();
      const legalCombatants = new Set<string>();
      const trace: string[] = [];
      try {
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        for (let index = 0; index < 1600 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing decision');
          const pilot = session.view.seats[0];
          const opponent = session.view.seats[1];
          const farm = session.view.stack.find((card) => card.name.includes('Farm'));
          if (cast && farm !== undefined) source ??= farm.oid;
          if (source !== undefined && pilot.graveyard.some((card) => card.oid === source)) {
            expect(target).toBeDefined();
            expect(opponent.graveyard.some((card) => card.oid === target)).toBe(true);
            expect(opponent.battlefield.some((card) => card.oid === target)).toBe(false);
            for (const oid of survivors)
              expect(opponent.battlefield.some((card) => card.oid === oid)).toBe(true);
            expect(pilot.exile.some((card) => card.oid === source)).toBe(false);
            resolved = true;
            break;
          }
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.seat}/${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
          );
          let move: string | undefined;
          if (decision.kind === 'priority') {
            const spell = decision.options.find((option) =>
              option.text.includes('Destroy target attacking or blocking creature'),
            );
            if (
              decision.seat === 0 &&
              session.view.turn.step === 'MAIN1' &&
              pilot.battlefield.filter((card) => card.name === 'Plains').length >= 3 &&
              pilot.hand?.some((card) => card.name.includes('Farm'))
            ) {
              expect(spell).toBeUndefined();
              noCombatChecked = true;
            }
            if (decision.seat === 0 && spell !== undefined && combatants.size > 0 && !cast) {
              move = spell.id;
              cast = true;
            } else if (!cast) {
              move = decision.options.find(
                (option) => option.text === (decision.seat === 0 ? 'Play Plains' : 'Play Mountain'),
              )?.id;
              if (
                decision.seat === 1 &&
                opponent.battlefield.filter((card) => card.name === 'Defiant Khenra').length < 2
              ) {
                move ??= decision.options.find((option) => option.text.startsWith('Defiant Khenra:'))?.id;
              }
              if (
                decision.seat === 0 &&
                role === 'blocking' &&
                !pilot.battlefield.some((card) => card.name === 'Sacred Cat')
              ) {
                move ??= decision.options.find(
                  (option) => option.text.startsWith('Sacred Cat:') && !option.text.includes('Embalm'),
                )?.id;
              }
            }
          } else if (decision.kind === 'mana-payment') {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          } else if (decision.kind === 'combat-attackers') {
            if (
              !cast &&
              noCombatChecked &&
              opponent.battlefield.filter((card) => card.name === 'Defiant Khenra').length === 2 &&
              decision.seat === (role === 'attacking' ? 1 : 0)
            ) {
              const attack =
                combatants.size === 0
                  ? decision.options.find((option) => option.id.startsWith('combat-attack-add-'))
                  : undefined;
              move = attack?.id;
              if (attack?.targets[0] !== undefined) legalCombatants.add(attack.targets[0].oid);
              if (role === 'attacking' && attack?.targets[0] !== undefined)
                combatants.add(attack.targets[0].oid);
            }
          } else if (
            decision.kind === 'combat-blockers' &&
            role === 'blocking' &&
            decision.seat === 1 &&
            combatants.size === 0
          ) {
            const block = decision.options.find((option) => option.id.startsWith('combat-block-add-'));
            move = block?.id;
            const blocker = block?.targets.find((entry) => entry.name === 'Defiant Khenra');
            if (blocker !== undefined) {
              combatants.add(blocker.oid);
              legalCombatants.add(blocker.oid);
            }
          } else if (decision.kind === 'target-selection') {
            expect(cast).toBe(true);
            const targets = decision.options.flatMap((option) => option.targets);
            expect(targets.length).toBeGreaterThan(0);
            for (const entry of targets) expect(legalCombatants.has(entry.oid)).toBe(true);
            expect(new Set(targets.map((entry) => entry.oid))).toEqual(legalCombatants);
            const selected = decision.options.find((option) =>
              option.targets.some((entry) => combatants.has(entry.oid)),
            );
            target = selected?.targets[0]?.oid;
            survivors = opponent.battlefield
              .filter((card) => card.name === 'Defiant Khenra' && card.oid !== target)
              .map((card) => card.oid);
            expect(survivors).toHaveLength(1);
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            rejectedInvalid = true;
            move = selected?.id;
          } else if (decision.kind === 'discard-selection') {
            move =
              decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
              decision.options[0]?.id;
          }
          move ??= decision.options.find(
            (option) =>
              ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
              ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
          )?.id;
          if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
          if (decision.kind === 'target-selection') {
            await expect(session.submit(move)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            rejectedStale = true;
          }
          session = advanced.session;
        }
        expect(resolved, trace.slice(-12).join('\n')).toBe(true);
        expect(noCombatChecked).toBe(true);
        expect(rejectedInvalid).toBe(true);
        expect(rejectedStale).toBe(true);
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
}
