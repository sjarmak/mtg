/** Installed-Forge proof for Stratus Dancer's exact megamorph counter trigger. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

const spec: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Stratus pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-stratus-dancer-exact-outcomes',
        cards: [
          { name: 'Island', count: 32 },
          { name: 'Stratus Dancer', count: 28 },
        ],
      },
    },
    {
      name: 'Spell pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-stratus-dancer-counter-target',
        cards: [
          { name: 'Mountain', count: 36 },
          { name: 'Lightning Bolt', count: 24 },
        ],
      },
    },
  ],
  seed: 'z5q4-stratus-dancer-exact-outcomes',
  maximumTurns: 30,
};

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

function counterTotal(card: ObservedSession['view']['seats'][number]['battlefield'][number]): number {
  return Object.values(card.counters).reduce((sum, count) => sum + count, 0);
}

forgeIt(
  'rolls back megamorph, then counters the exact live instant and leaves a 3/2 Stratus Dancer',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let stratusOid: string | null = null;
    let boltOid: string | null = null;
    let castFaceDown = false;
    let observedFaceDown = false;
    let faceUpAttempts = 0;
    let faceUpPaymentActive = false;
    let faceUpPaymentSteps = 0;
    let canceled = false;
    let rollbackLife: number | null = null;
    let rollbackUntappedMana: number | null = null;
    let rollbackObserved = false;
    let exactTargetSelected = false;
    let staleRejected = false;
    let completed = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Stratus Dancer decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (pilot.hand === null || opponent.hand === null) {
          throw new Error('Forge hid a local seat hand');
        }
        stratusOid ??=
          pilot.hand.find((card) => card.name === 'Stratus Dancer')?.oid ??
          pilot.battlefield.find((card) => card.name === 'Stratus Dancer')?.oid ??
          null;
        const stratus = pilot.battlefield.find((card) => card.oid === stratusOid);
        observedFaceDown ||=
          castFaceDown &&
          stratus !== undefined &&
          stratus.power === 2 &&
          stratus.toughness === 2 &&
          stratus.name !== 'Stratus Dancer';
        boltOid ??= session.view.stack.find((card) => card.name === 'Lightning Bolt')?.oid ?? null;
        if (canceled && !rollbackObserved && decision.kind === 'priority' && decision.seat === 0) {
          rollbackObserved =
            rollbackLife !== null &&
            rollbackUntappedMana !== null &&
            pilot.life === rollbackLife &&
            pilot.battlefield.filter((card) => card.name === 'Island' && !card.tapped).length ===
              rollbackUntappedMana &&
            stratus !== undefined &&
            stratus.name !== 'Stratus Dancer' &&
            stratus.power === 2 &&
            stratus.toughness === 2 &&
            boltOid !== null &&
            session.view.stack.some((card) => card.oid === boltOid);
          faceUpPaymentActive = false;
        }
        const faceUp = pilot.battlefield.find(
          (card) => card.oid === stratusOid && card.name === 'Stratus Dancer',
        );
        completed =
          exactTargetSelected &&
          staleRejected &&
          rollbackObserved &&
          faceUp !== undefined &&
          faceUp.power === 3 &&
          faceUp.toughness === 2 &&
          counterTotal(faceUp) === 1 &&
          boltOid !== null &&
          opponent.graveyard.some((card) => card.oid === boltOid) &&
          pilot.life === 20 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.active}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          if (faceUpPaymentActive && faceUpAttempts === 1) {
            if (faceUpPaymentSteps === 0) {
              move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
              faceUpPaymentSteps += move === undefined ? 0 : 1;
            } else {
              move = decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
              canceled ||= move !== undefined;
            }
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.kind === 'target-selection') {
          const stackTargets = decision.options.filter((option) => option.id.startsWith('target-stack-'));
          if (stackTargets.length > 0) {
            expect(stackTargets).toHaveLength(1);
            expect(stackTargets[0]!.targets).toEqual([{ oid: boltOid, name: 'Lightning Bolt' }]);
            await expect(session.submit('target-stack-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            const staleSession = session;
            const selected = stackTargets[0]!.id;
            const advanced = await session.submit(selected);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            exactTargetSelected = true;
            await expect(staleSession.submit(selected)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            faceUpPaymentActive = false;
            continue;
          }
          move = decision.options.find((option) => option.id === 'target-player-0')?.id;
        } else if (decision.kind === 'priority') {
          const untappedPilotMana = pilot.battlefield.filter(
            (card) => card.name === 'Island' && !card.tapped,
          ).length;
          const untappedOpponentMana = opponent.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const boltOnStack = boltOid !== null && session.view.stack.some((card) => card.oid === boltOid);
          const faceDown = decision.options.find(
            (option) => option.text.includes('Stratus Dancer') && /face down|morph/iu.test(option.text),
          );
          const turnFaceUp = decision.options.find((option) => /turn.*face up/iu.test(option.text));
          const castBolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          move =
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Island')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && !castFaceDown && untappedPilotMana >= 3 ? faceDown?.id : undefined) ??
            (decision.seat === 1 &&
            observedFaceDown &&
            boltOid === null &&
            untappedPilotMana >= 2 &&
            untappedOpponentMana >= 1
              ? castBolt?.id
              : undefined) ??
            (decision.seat === 0 &&
            observedFaceDown &&
            boltOnStack &&
            (faceUpAttempts === 0 || rollbackObserved)
              ? turnFaceUp?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move !== undefined && move === faceDown?.id) castFaceDown = true;
          if (move !== undefined && move === turnFaceUp?.id) {
            faceUpAttempts += 1;
            faceUpPaymentActive = true;
            if (faceUpAttempts === 1) {
              rollbackLife = pilot.life;
              rollbackUntappedMana = untappedPilotMana;
            }
          }
        }

        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Stratus Dancer move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-520).join('\n')}\nview=${JSON.stringify(session.view)}\nevents=${JSON.stringify(session.events)}`;
      expect(stratusOid, evidence).toMatch(/^forge-card-/u);
      expect(boltOid, evidence).toMatch(/^forge-card-/u);
      expect(castFaceDown, evidence).toBe(true);
      expect(observedFaceDown, evidence).toBe(true);
      expect(faceUpAttempts, evidence).toBe(2);
      expect(faceUpPaymentSteps, evidence).toBe(1);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(exactTargetSelected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(completed, evidence).toBe(true);
      const boltInstance = `Lightning Bolt (${boltOid!.replace('forge-card-', '')})`;
      const resolved = session.events.filter((event) => event.type === 'Resolve Stack');
      expect(
        resolved
          .map((event) => event.text)
          .filter(
            (text) =>
              text.startsWith('When Stratus Dancer is turned face up, counter target instant') &&
              text.includes('Targeting: [[Lightning Bolt deals 3 damage to any target.]]'),
          ),
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
