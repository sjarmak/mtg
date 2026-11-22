/** Installed-Forge proof for Animate Dead's exact graveyard Aura lifecycle. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Animate Dead pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-animate-dead-lifecycle',
        cards: [
          { name: 'Swamp', count: 24 },
          { name: 'Entomb', count: 12 },
          { name: 'Animate Dead', count: 12 },
          { name: 'Baneslayer Angel', count: 12 },
        ],
      },
    },
    {
      name: 'Aura-removal opponent',
      controller: 'local',
      deck: {
        name: 'z5q4-animate-dead-lifecycle-opponent',
        cards: [
          { name: 'Scrubland', count: 30 },
          { name: 'Vindicate', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-animate-dead-lifecycle-outcome',
  maximumTurns: 40,
};

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  if (decision.kind === 'discard-selection') {
    return (
      decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
      decision.options.find((option) => option.targets.length === 1)?.id
    );
  }
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

forgeIt(
  'owns exact graveyard targeting, reanimation attachment, -1/-0, and leaves-Aura sacrifice',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let entombedOid: string | null = null;
    let pending: 'animate-cancel' | 'animate-select' | 'destroy-aura' | null = null;
    let canceled = false;
    let cancelRollbackObserved = false;
    let selected = false;
    let inventedRejected = false;
    let staleRejected = false;
    let reanimatedAttachedAndWeakened = false;
    let destructionCast = false;
    let sacrificed = false;
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Animate Dead decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const reanimated =
          entombedOid === null ? undefined : pilot.battlefield.find((card) => card.oid === entombedOid);
        const aura = pilot.battlefield.find((card) => card.name === 'Animate Dead');
        reanimatedAttachedAndWeakened ||=
          selected &&
          reanimated?.name === 'Baneslayer Angel' &&
          reanimated.controller === 0 &&
          reanimated.power === 4 &&
          reanimated.toughness === 5 &&
          aura !== undefined &&
          !pilot.graveyard.some((card) => card.oid === entombedOid);
        sacrificed ||=
          destructionCast &&
          reanimatedAttachedAndWeakened &&
          aura === undefined &&
          entombedOid !== null &&
          pilot.graveyard.some((card) => card.oid === entombedOid) &&
          pilot.graveyard.some((card) => card.name === 'Animate Dead');

        let move: string | undefined;
        let staleMove: string | null = null;
        const staleSession = session;
        if (decision.kind === 'zone-card-selection') {
          const angel = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Baneslayer Angel',
          );
          if (angel === undefined) throw new Error('Entomb offered no Baneslayer Angel');
          entombedOid = angel.targets[0]!.oid;
          move = angel.id;
        } else if (decision.kind === 'target-selection') {
          if (pending === null) throw new Error(`unexpected target decision: ${decision.prompt}`);
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
          if (pending === 'animate-cancel') {
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            if (cancel === undefined) throw new Error('Animate Dead offered no target cancellation');
            const advanced = await session.submit(cancel.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            const afterPilot = session.view.seats[0];
            cancelRollbackObserved =
              session.view.stack.every((card) => card.name !== 'Animate Dead') &&
              afterPilot.hand?.some((card) => card.name === 'Animate Dead') === true &&
              entombedOid !== null &&
              afterPilot.graveyard.some((card) => card.oid === entombedOid);
            canceled = true;
            pending = null;
            continue;
          }
          if (pending === 'animate-select') {
            const candidates = decision.options.filter((option) => option.targets.length === 1);
            expect(candidates).toHaveLength(1);
            expect(candidates[0]?.targets[0]).toEqual({ oid: entombedOid, name: 'Baneslayer Angel' });
            const target = candidates[0];
            if (target === undefined) throw new Error('Animate Dead offered no exact graveyard creature');
            move = target.id;
            staleMove = target.id;
            selected = true;
          } else {
            const exactAura = decision.options.find(
              (option) => option.targets.length === 1 && option.targets[0]?.name === 'Animate Dead',
            );
            if (exactAura === undefined) throw new Error('Vindicate offered no Animate Dead target');
            move = exactAura.id;
          }
          pending = null;
        } else if (decision.kind === 'priority') {
          const pilotLands = pilot.battlefield.filter((card) => card.name === 'Swamp');
          const untappedPilotLands = pilotLands.filter((card) => !card.tapped).length;
          const opponentLands = opponent.battlefield.filter((card) => card.name === 'Scrubland');
          const untappedOpponentLands = opponentLands.filter((card) => !card.tapped).length;
          const entomb = decision.options.find((option) => option.text.startsWith('Entomb:'));
          const animate = decision.options.find((option) => option.text.startsWith('Animate Dead:'));
          const vindicate = decision.options.find((option) => option.text.startsWith('Vindicate:'));
          move =
            (sacrificed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Swamp')?.id
              : undefined) ??
            (decision.seat === 1
              ? decision.options.find((option) => option.text === 'Play Scrubland')?.id
              : undefined) ??
            (decision.seat === 0 &&
            entombedOid === null &&
            pilotLands.length >= 1 &&
            untappedPilotLands >= 1 &&
            session.view.stack.length === 0
              ? entomb?.id
              : undefined) ??
            (decision.seat === 0 &&
            entombedOid !== null &&
            !canceled &&
            pilotLands.length >= 2 &&
            untappedPilotLands >= 2 &&
            session.view.stack.length === 0
              ? animate?.id
              : undefined) ??
            (decision.seat === 0 &&
            canceled &&
            !selected &&
            pilotLands.length >= 2 &&
            untappedPilotLands >= 2 &&
            session.view.stack.length === 0
              ? animate?.id
              : undefined) ??
            (decision.seat === 1 &&
            reanimatedAttachedAndWeakened &&
            !destructionCast &&
            opponentLands.length >= 3 &&
            untappedOpponentLands >= 3 &&
            session.view.stack.length === 0
              ? vindicate?.id
              : undefined);
          if (animate !== undefined && move === animate.id) {
            pending = canceled ? 'animate-select' : 'animate-cancel';
          }
          if (vindicate !== undefined && move === vindicate.id) {
            pending = 'destroy-aura';
            destructionCast = true;
          }
        }

        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Animate Dead move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleMove !== null) {
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
      }

      const evidence = `${trace.slice(-500).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(entombedOid, evidence).toMatch(/^forge-card-/u);
      expect(canceled, evidence).toBe(true);
      expect(cancelRollbackObserved, evidence).toBe(true);
      expect(selected, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(reanimatedAttachedAndWeakened, evidence).toBe(true);
      expect(destructionCast, evidence).toBe(true);
      expect(sacrificed, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-500).join('\n')}`, { cause });
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
