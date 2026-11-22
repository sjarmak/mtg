/** Installed-Forge proof that ordinary blocker damage is not a noncombat callback. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Attacking pilot',
      controller: 'local',
      deck: {
        name: 'ordinary-blocker-attacker',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Goblin Guide', count: 30 },
        ],
      },
    },
    {
      name: 'Blocking pilot',
      controller: 'local',
      deck: {
        name: 'ordinary-blocker-defender',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Student of Warfare', count: 30 },
        ],
      },
    },
  ],
  seed: 'ordinary-blocker-damage-installed-forge',
  maximumTurns: 8,
};

forgeIt(
  'resolves damage from a current blocker through ordinary combat',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let attackerAdded = false;
    let blockerAdded = false;
    let blockerCommitted = false;
    let combatResolved = false;
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no ordinary-combat decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        if (blockerCommitted && session.view.turn.step === 'COMBAT_END') {
          combatResolved = true;
        }

        let move = decision.options.find(
          (option) => option.id === 'pregame-start-seat-0' || option.text === 'Keep this hand',
        )?.id;

        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'trigger-order') {
          move = decision.options[0]?.id;
        } else if (decision.kind === 'combat-attackers') {
          const guide = session.view.seats[0].battlefield.find((card) => card.name === 'Goblin Guide');
          const canTestBlock =
            decision.seat === 0 &&
            session.view.seats[1].battlefield.some((card) => card.name === 'Student of Warfare');
          const add = decision.options.find(
            (option) =>
              canTestBlock &&
              !attackerAdded &&
              option.id.startsWith('combat-attack-add-') &&
              option.targets[0]?.oid === guide?.oid,
          );
          if (add !== undefined) {
            attackerAdded = true;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            if (!canTestBlock) attackerAdded = false;
          }
        } else if (decision.kind === 'combat-blockers') {
          const student = session.view.seats[1].battlefield.find(
            (card) => card.name === 'Student of Warfare',
          );
          const guide = session.view.seats[0].battlefield.find((card) => card.name === 'Goblin Guide');
          const add = decision.options.find(
            (option) =>
              !blockerAdded &&
              option.id.startsWith('combat-block-add-') &&
              option.targets[0]?.oid === student?.oid &&
              option.targets[1]?.oid === guide?.oid,
          );
          if (add !== undefined) {
            blockerAdded = true;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
            blockerCommitted ||= blockerAdded;
          }
        } else if (decision.kind === 'priority') {
          const seat = session.view.seats[decision.seat];
          const creature = decision.seat === 0 ? 'Goblin Guide' : 'Student of Warfare';
          const land = decision.seat === 0 ? 'Mountain' : 'Plains';
          move =
            (combatResolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === `Play ${land}`)?.id ??
            (!seat?.battlefield.some((card) => card.name === creature)
              ? decision.options.find((option) => option.text.startsWith(`${creature}:`))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no ordinary-combat move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-250).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(attackerAdded, evidence).toBe(true);
      expect(blockerAdded, evidence).toBe(true);
      expect(blockerCommitted, evidence).toBe(true);
      expect(combatResolved, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-250).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  240_000,
);
