/** Installed-Forge proof for Recurring Nightmare's sacrifice-return-reanimate route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const spec: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Nightmare pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-recurring-nightmare-outcomes',
        cards: [
          { name: 'Mana Confluence', count: 36 },
          { name: 'Selfless Spirit', count: 8 },
          { name: 'Llanowar Elves', count: 8 },
          { name: 'Recurring Nightmare', count: 8 },
        ],
      },
    },
    {
      name: 'Nightmare observer',
      controller: 'local',
      deck: { name: 'z5q4-nightmare-observer', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-recurring-nightmare-exact-outcomes',
  maximumTurns: 36,
};

forgeIt(
  'sacrifices one exact creature, returns itself, and reanimates the exact graveyard target',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let spiritOid: string | null = null;
    let nightmareOid: string | null = null;
    let sacrificedOid: string | null = null;
    let spiritSacrificed = false;
    let activationStarted = false;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    let completed = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Recurring Nightmare decision');
        const local = session.view.seats[0];
        if (local.hand === null) throw new Error('Forge hid the local seat hand');
        const spirit = local.battlefield.find((card) => card.name === 'Selfless Spirit');
        const nightmare = local.battlefield.find((card) => card.name === 'Recurring Nightmare');
        spiritOid ??=
          spirit?.oid ?? local.graveyard.find((card) => card.name === 'Selfless Spirit')?.oid ?? null;
        nightmareOid ??=
          nightmare?.oid ?? local.hand.find((card) => card.name === 'Recurring Nightmare')?.oid ?? null;
        completed =
          activationStarted &&
          spiritOid !== null &&
          nightmareOid !== null &&
          sacrificedOid !== null &&
          local.battlefield.some((card) => card.oid === spiritOid) &&
          local.graveyard.some((card) => card.oid === sacrificedOid) &&
          local.hand.some((card) => card.oid === nightmareOid) &&
          !local.battlefield.some((card) => card.oid === nightmareOid) &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'target-selection' && activationStarted) {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length).toBeGreaterThan(0);
          expect(
            candidates.every((option) => local.graveyard.some((card) => card.oid === option.targets[0]?.oid)),
          ).toBe(true);
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const selected = candidates.find((option) => option.targets[0]?.oid === spiritOid);
          if (selected === undefined) throw new Error('Forge offered no exact Selfless Spirit target');
          staleSnapshot = session;
          staleMove = selected.id;
          move = selected.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length).toBeGreaterThan(0);
          expect(
            candidates.every((option) =>
              local.battlefield.some((card) => card.oid === option.targets[0]?.oid),
            ),
          ).toBe(true);
          await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const selected = candidates.find((option) => option.targets[0]?.name === 'Llanowar Elves');
          if (selected === undefined) throw new Error('Forge offered no exact Llanowar Elves sacrifice');
          sacrificedOid = selected.targets[0]!.oid;
          staleSnapshot = session;
          staleMove = selected.id;
          move = selected.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const elf = local.battlefield.find((card) => card.name === 'Llanowar Elves');
          const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence');
          const sacrificeSpirit = decision.options.find(
            (option) => option.text.startsWith('Selfless Spirit:') && option.text.includes('indestructible'),
          );
          const activateNightmare = decision.options.find(
            (option) =>
              option.text.startsWith('Recurring Nightmare:') && option.text.includes('Sacrifice a creature'),
          );
          move =
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ??
            (!spiritSacrificed && spirit === undefined && lands.length >= 2
              ? decision.options.find((option) => option.text.startsWith('Selfless Spirit:'))?.id
              : undefined) ??
            (!spiritSacrificed && spirit !== undefined ? sacrificeSpirit?.id : undefined) ??
            (spiritSacrificed && nightmare === undefined && lands.length >= 3
              ? decision.options.find((option) => option.text.startsWith('Recurring Nightmare:'))?.id
              : undefined) ??
            (spiritSacrificed && elf === undefined
              ? decision.options.find((option) => option.text.startsWith('Llanowar Elves:'))?.id
              : undefined) ??
            (!activationStarted && nightmare !== undefined && elf !== undefined
              ? activateNightmare?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          spiritSacrificed ||= sacrificeSpirit !== undefined && move === sacrificeSpirit.id;
          activationStarted ||= activateNightmare !== undefined && move === activateNightmare.id;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Recurring Nightmare move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      const evidence = `${trace.slice(-520).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(spiritOid, evidence).toMatch(/^forge-card-/u);
      expect(nightmareOid, evidence).toMatch(/^forge-card-/u);
      expect(sacrificedOid, evidence).toMatch(/^forge-card-/u);
      expect(completed, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-520).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  300_000,
);
