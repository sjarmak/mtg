/** Installed-Forge proof for Glen Elendra Archmage's sacrifice-counter-Persist route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const spec: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Archmage pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-glen-elendra-exact-outcomes',
        cards: [
          { name: 'Island', count: 36 },
          { name: 'Glen Elendra Archmage', count: 24 },
        ],
      },
    },
    {
      name: 'Spell pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-glen-elendra-counter-target',
        cards: [
          { name: 'Mountain', count: 36 },
          { name: 'Lightning Bolt', count: 24 },
        ],
      },
    },
  ],
  seed: 'z5q4-glen-elendra-exact-outcomes',
  maximumTurns: 40,
};

function counterTotal(card: ObservedSession['view']['seats'][number]['battlefield'][number]): number {
  return Object.values(card.counters).reduce((sum, count) => sum + count, 0);
}

forgeIt(
  'counters one exact noncreature spell and returns the sacrificed source with one counter',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let archmageOid: string | null = null;
    let boltOid: string | null = null;
    let activationStarted = false;
    let exactTargetSelected = false;
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
        if (decision === null) throw new Error('Forge offered no Glen Elendra Archmage decision');
        const archmagePilot = session.view.seats[0];
        const spellPilot = session.view.seats[1];
        if (archmagePilot.hand === null || spellPilot.hand === null) {
          throw new Error('Forge hid a local seat hand');
        }
        archmageOid ??=
          archmagePilot.battlefield.find((card) => card.name === 'Glen Elendra Archmage')?.oid ??
          archmagePilot.hand.find((card) => card.name === 'Glen Elendra Archmage')?.oid ??
          null;
        boltOid ??= session.view.stack.find((card) => card.name === 'Lightning Bolt')?.oid ?? null;
        const returned = archmagePilot.battlefield.find((card) => card.oid === archmageOid);
        completed =
          activationStarted &&
          exactTargetSelected &&
          archmageOid !== null &&
          boltOid !== null &&
          returned !== undefined &&
          counterTotal(returned) === 1 &&
          spellPilot.graveyard.some((card) => card.oid === boltOid) &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.active}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'target-selection') {
          if (activationStarted) {
            const candidates = decision.options.filter(
              (option) => option.targets.length === 1 && option.id.startsWith('target-stack-'),
            );
            expect(candidates).toHaveLength(1);
            expect(candidates[0]!.targets[0]?.oid).toBe(boltOid);
            await expect(session.submit('target-stack-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            staleSnapshot = session;
            staleMove = candidates[0]!.id;
            exactTargetSelected = true;
            move = candidates[0]!.id;
          } else {
            move = decision.options.find((option) => option.id === 'target-player-0')?.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const archmage = archmagePilot.battlefield.find((card) => card.oid === archmageOid);
          const untappedIslands = archmagePilot.battlefield.filter(
            (card) => card.name === 'Island' && !card.tapped,
          ).length;
          const untappedMountains = spellPilot.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const boltOnStack = boltOid !== null && session.view.stack.some((card) => card.oid === boltOid);
          const activate: (typeof decision.options)[number] | undefined =
            decision.seat === 0 && archmage !== undefined && boltOnStack && !activationStarted
              ? decision.options.find((option) => option.text.startsWith('Glen Elendra Archmage:'))
              : undefined;
          const castBolt: (typeof decision.options)[number] | undefined =
            decision.seat === 1 &&
            boltOid === null &&
            archmage !== undefined &&
            untappedIslands >= 1 &&
            untappedMountains >= 1
              ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
              : undefined;
          move =
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Island')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            activate?.id ??
            castBolt?.id ??
            (decision.seat === 0 && archmage === undefined && untappedIslands >= 4
              ? decision.options.find((option) => option.text.startsWith('Glen Elendra Archmage:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          activationStarted ||= activate !== undefined && move === activate.id;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Glen Elendra Archmage move');
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
      expect(archmageOid, evidence).toMatch(/^forge-card-/u);
      expect(boltOid, evidence).toMatch(/^forge-card-/u);
      expect(completed, evidence).toBe(true);
      const resolved = session.events.filter((event) => event.type === 'Resolve Stack');
      const boltInstance = `Lightning Bolt (${boltOid!.replace('forge-card-', '')})`;
      expect(
        resolved.map((event) => event.text).filter((text) => text.includes(`Counter ${boltInstance}`)),
        evidence,
      ).toHaveLength(1);
      expect(
        resolved.map((event) => event.text).filter((text) => text.startsWith(boltInstance)),
        evidence,
      ).toEqual([]);
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
