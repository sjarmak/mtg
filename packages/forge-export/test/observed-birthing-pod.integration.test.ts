/** Installed-Forge proof for Birthing Pod's exact Phyrexian sacrifice-search route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const spec: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Pod pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-birthing-pod-outcomes',
        cards: [
          { name: 'Forest', count: 36 },
          { name: 'Llanowar Elves', count: 8 },
          { name: 'Wall of Blossoms', count: 8 },
          { name: 'Birthing Pod', count: 8 },
        ],
      },
    },
    {
      name: 'Pod observer',
      controller: 'local',
      deck: { name: 'z5q4-pod-observer', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-birthing-pod-exact-outcomes',
  maximumTurns: 30,
};

forgeIt(
  'pays life, sacrifices one exact creature, and puts only the derived-mana-value result onto the battlefield',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let podOid: string | null = null;
    let sacrificedOid: string | null = null;
    let fetchedOid: string | null = null;
    let activationStarted = false;
    let lifeBeforePhyrexian: number | null = null;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    let completed = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Birthing Pod decision');
        const local = session.view.seats[0];
        const pod = local.battlefield.find((card) => card.name === 'Birthing Pod');
        podOid ??= pod?.oid ?? null;
        completed =
          podOid !== null &&
          sacrificedOid !== null &&
          fetchedOid !== null &&
          lifeBeforePhyrexian !== null &&
          local.life === lifeBeforePhyrexian - 2 &&
          local.graveyard.some((card) => card.oid === sacrificedOid) &&
          local.battlefield.some((card) => card.oid === fetchedOid && card.name === 'Wall of Blossoms') &&
          local.battlefield.some((card) => card.oid === podOid && card.tapped) &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          const payLife = decision.options.find((option) => option.id === 'mana-payment-phyrexian-life');
          if (activationStarted && payLife !== undefined) {
            lifeBeforePhyrexian = local.life;
            move = payLife.id;
          } else {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          }
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          const battlefield = new Set(local.battlefield.map((card) => card.oid));
          expect(candidates.length).toBeGreaterThan(0);
          expect(candidates.every((option) => battlefield.has(option.targets[0]!.oid))).toBe(true);
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
        } else if (decision.kind === 'zone-card-selection' && activationStarted) {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length).toBeGreaterThan(0);
          expect(candidates.every((option) => option.targets[0]?.name === 'Wall of Blossoms')).toBe(true);
          await expect(session.submit('zone-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const selected = candidates[0];
          if (selected === undefined) throw new Error('Forge offered no exact mana-value-two creature');
          fetchedOid = selected.targets[0]!.oid;
          staleSnapshot = session;
          staleMove = selected.id;
          move = selected.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const elf = local.battlefield.find((card) => card.name === 'Llanowar Elves');
          const forests = local.battlefield.filter((card) => card.name === 'Forest');
          const untappedForest = forests.some((card) => !card.tapped);
          const castElf = decision.options.find((option) => option.text.startsWith('Llanowar Elves:'));
          const castPod = decision.options.find((option) => option.text.startsWith('Birthing Pod:'));
          const activatePod = decision.options.find(
            (option) =>
              option.text.startsWith('Birthing Pod:') && option.text.includes('Sacrifice a creature'),
          );
          move =
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (elf === undefined ? castElf?.id : undefined) ??
            (pod === undefined && forests.length >= 4 ? castPod?.id : undefined) ??
            (!activationStarted &&
            pod !== undefined &&
            elf !== undefined &&
            untappedForest &&
            session.view.turn.active === 0
              ? activatePod?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          activationStarted ||= activatePod !== undefined && move === activatePod.id;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Birthing Pod move');
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

      const evidence = `${trace.slice(-420).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(podOid, evidence).toMatch(/^forge-card-/u);
      expect(sacrificedOid, evidence).toMatch(/^forge-card-/u);
      expect(fetchedOid, evidence).toMatch(/^forge-card-/u);
      expect(lifeBeforePhyrexian, evidence).not.toBeNull();
      expect(completed, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-420).join('\n')}`, { cause });
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
