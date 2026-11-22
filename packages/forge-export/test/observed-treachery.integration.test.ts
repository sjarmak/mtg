/** Installed-Forge proof for Treachery's exact Aura-control and land-untap route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Treachery pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-treachery-exact',
        cards: [
          { name: 'Mana Confluence', count: 36 },
          { name: 'Treachery', count: 18 },
          { name: 'Vindicate', count: 6 },
        ],
      },
    },
    {
      name: 'Duplicate creature opponent',
      controller: 'local',
      deck: {
        name: 'z5q4-treachery-opponent',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Figure of Destiny', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-treachery-control-and-all-battlefield-untap',
  maximumTurns: 24,
};

function routineMove(session: ObservedSession): string | undefined {
  const decision = session.decision;
  if (decision === null) return undefined;
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      (decision.kind === 'priority' && option.text === 'Pass priority') ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

function rollbackState(session: ObservedSession): string {
  const pilot = session.view.seats[0];
  return JSON.stringify({
    hand: (pilot.hand ?? []).map((card) => card.oid).sort(),
    battlefield: pilot.battlefield
      .map((card) => ({ oid: card.oid, tapped: card.tapped }))
      .sort((left, right) => left.oid.localeCompare(right.oid)),
    stack: session.view.stack.map((card) => card.oid).sort(),
  });
}

forgeIt(
  'owns exact rollback, duplicate target, all-battlefield maximum-five untap, and control restoration',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(TABLE)).toEqual([]);
    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let stage: 'payment-cancel' | 'target-cancel' | 'zero' | 'resolve' | 'destroy' | 'done' =
      'payment-cancel';
    let rollbackBefore: string | null = null;
    let paidOneBeforeCancel = false;
    let paymentRollback = false;
    let targetRollback = false;
    let targetOid: string | null = null;
    let controlObserved = false;
    let controlRestored = false;
    let inventedTargetRejected = false;
    let staleTargetRejected = false;
    let inventedLandRejected = false;
    let staleLandRejected = false;
    let candidateOids: string[] = [];
    const selectedOids: string[] = [];
    let selectedOpposingLand = false;
    let selectedLandsUntapped = false;
    let unselectedLandStayedTapped = false;
    let zeroSelectionCompleted = false;
    let selectionCompleted = false;
    let priorAuraOids = new Set<string>();
    let staleTargetSession: ObservedSession | null = null;
    let staleTargetMove: string | null = null;
    let staleLandSession: ObservedSession | null = null;
    let staleLandMove: string | null = null;
    let refreshPriority = false;
    const trace: string[] = [];
    try {
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Treachery decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (rollbackBefore !== null && decision.kind === 'priority') {
          if (stage === 'payment-cancel' && paidOneBeforeCancel) {
            paymentRollback ||= rollbackState(session) === rollbackBefore;
            if (paymentRollback) stage = 'target-cancel';
          } else if (stage === 'target-cancel') {
            targetRollback ||= rollbackState(session) === rollbackBefore;
            if (targetRollback) stage = 'zero';
          }
          rollbackBefore = null;
        }
        if (targetOid !== null) {
          controlObserved ||= pilot.battlefield.some((card) => card.oid === targetOid);
          controlRestored ||= controlObserved && opponent.battlefield.some((card) => card.oid === targetOid);
        }
        if (selectionCompleted && !selectedLandsUntapped) {
          selectedLandsUntapped = selectedOids.every((oid) =>
            [...pilot.battlefield, ...opponent.battlefield].some((card) => card.oid === oid && !card.tapped),
          );
          unselectedLandStayedTapped = candidateOids.some(
            (oid) =>
              !selectedOids.includes(oid) &&
              [...pilot.battlefield, ...opponent.battlefield].some((card) => card.oid === oid && card.tapped),
          );
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = routineMove(session);
        if (decision.kind === 'mana-payment') {
          if (decision.seat === 0 && stage === 'payment-cancel') {
            if (!paidOneBeforeCancel) {
              move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
              paidOneBeforeCancel = move !== undefined;
            } else {
              move = decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
            }
          } else {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          }
        } else if (decision.kind === 'target-selection') {
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedTargetRejected = true;
          if (stage === 'target-cancel') {
            move = decision.options.find((option) => option.id === 'target-cancel')?.id;
          } else if (stage === 'zero' || stage === 'resolve') {
            const creatures = decision.options.filter(
              (option) =>
                option.targets.length === 1 &&
                option.targets[0]?.name === 'Figure of Destiny' &&
                opponent.battlefield.some((card) => card.oid === option.targets[0]?.oid),
            );
            expect(creatures.length).toBeGreaterThanOrEqual(2);
            expect(new Set(creatures.map((option) => option.targets[0]!.oid)).size).toBe(creatures.length);
            const selected = creatures[1];
            if (selected === undefined) throw new Error('Forge offered no second duplicate creature');
            if (stage === 'resolve') targetOid = selected.targets[0]!.oid;
            staleTargetSession = session;
            staleTargetMove = selected.id;
            move = selected.id;
          } else if (stage === 'destroy') {
            const aura = decision.options.find(
              (option) =>
                option.targets.length === 1 &&
                option.targets[0]?.name === 'Treachery' &&
                !priorAuraOids.has(option.targets[0].oid),
            );
            if (aura === undefined) throw new Error('Forge offered no Treachery target to Vindicate');
            move = aura.id;
            stage = 'done';
          }
        } else if (decision.kind === 'card-selection' && stage === 'zero') {
          const done = decision.options.find((option) => option.id === 'card-selection-done');
          if (done === undefined) throw new Error('Forge offered no zero-land Treachery choice');
          move = done.id;
        } else if (decision.kind === 'card-selection' && stage === 'resolve') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          if (candidateOids.length === 0) {
            candidateOids = candidates.map((option) => option.targets[0]!.oid);
            expect(candidateOids.length).toBeGreaterThan(5);
            expect(
              candidates.every(
                (option) =>
                  option.targets[0]?.name === 'Mana Confluence' || option.targets[0]?.name === 'Plains',
              ),
            ).toBe(true);
            await expect(session.submit('card-selection-forge-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedLandRejected = true;
          }
          const opposing = candidates.find((option) =>
            opponent.battlefield.some((card) => card.oid === option.targets[0]?.oid),
          );
          const selected =
            (selectedOids.length === 0 ? opposing : undefined) ??
            candidates.find((option) => !selectedOids.includes(option.targets[0]!.oid));
          if (selected === undefined) throw new Error('Forge offered no next Treachery land');
          selectedOids.push(selected.targets[0]!.oid);
          selectedOpposingLand ||= opposing?.id === selected.id;
          if (staleLandSession === null) {
            staleLandSession = session;
            staleLandMove = selected.id;
          }
          move = selected.id;
        } else if (decision.kind === 'priority') {
          const currentHandIds = new Set(
            (session.view.seats[decision.seat]?.hand ?? []).map((card) =>
              card.oid.replace(/^forge-card-/u, ''),
            ),
          );
          const currentHandAbility = (name: string) =>
            decision.options.find(
              (option) =>
                option.text.startsWith(`${name}:`) &&
                [...currentHandIds].some((id) => option.id.startsWith(`ability-${id}-`)),
            );
          const currentHandLand = (name: string) =>
            decision.options.find(
              (option) =>
                option.text === `Play ${name}` &&
                [...currentHandIds].some((id) => option.id.startsWith(`ability-${id}-`)),
            );
          const localMana = pilot.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const opposingMana = opponent.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          const treachery = currentHandAbility('Treachery');
          const creature = currentHandAbility('Figure of Destiny');
          const figureActivation = decision.options.find((option) =>
            option.text.startsWith('Figure of Destiny: {R/W}:'),
          );
          const vindicate = currentHandAbility('Vindicate');
          const opposingLandPrepared = opponent.battlefield.some(
            (card) => card.name === 'Plains' && card.tapped,
          );
          move = refreshPriority
            ? decision.options.find((option) => option.text === 'Pass priority')?.id
            : ((decision.seat === 0
                ? currentHandLand('Mana Confluence')?.id
                : currentHandLand('Plains')?.id) ??
              (decision.seat === 1 &&
              session.view.stack.length === 0 &&
              opponent.battlefield.filter((card) => card.name === 'Figure of Destiny').length < 2 &&
              opposingMana >= 1
                ? creature?.id
                : undefined) ??
              (decision.seat === 1 &&
              session.view.turn.active === 0 &&
              session.view.stack.length === 0 &&
              localMana >= 5 &&
              opponent.battlefield.filter((card) => card.name === 'Figure of Destiny').length >= 2 &&
              !opposingLandPrepared &&
              opposingMana >= 1
                ? figureActivation?.id
                : undefined) ??
              (decision.seat === 0 &&
              session.view.stack.length === 0 &&
              stage !== 'destroy' &&
              stage !== 'done' &&
              localMana >= 5 &&
              opponent.battlefield.filter((card) => card.name === 'Figure of Destiny').length >= 2 &&
              opposingLandPrepared
                ? treachery?.id
                : undefined) ??
              (decision.seat === 0 &&
              session.view.stack.length === 0 &&
              stage === 'destroy' &&
              controlObserved &&
              localMana >= 3
                ? vindicate?.id
                : undefined) ??
              (stage === 'done' && controlRestored
                ? decision.options.find((option) => option.text === 'Concede')?.id
                : undefined) ??
              move);
          refreshPriority = false;
          if (move === treachery?.id) {
            if (stage === 'payment-cancel' || stage === 'target-cancel') {
              rollbackBefore = rollbackState(session);
            }
            if (stage === 'resolve') {
              priorAuraOids = new Set(
                pilot.battlefield.filter((card) => card.name === 'Treachery').map((card) => card.oid),
              );
            }
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error(`Unhandled Treachery decision: ${decision.kind}`);
        const oldKind = decision.kind;
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        refreshPriority = oldKind !== 'priority' && session.decision?.kind === 'priority';
        if (staleTargetSession !== null && staleTargetMove !== null) {
          await expect(staleTargetSession.submit(staleTargetMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleTargetRejected = true;
          staleTargetSession = null;
          staleTargetMove = null;
        }
        if (staleLandSession !== null && staleLandMove !== null) {
          await expect(staleLandSession.submit(staleLandMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleLandRejected = true;
          staleLandSession = null;
          staleLandMove = null;
        }
        if (oldKind === 'card-selection' && session.decision?.kind !== 'card-selection') {
          if (stage === 'zero') {
            zeroSelectionCompleted = true;
            stage = 'resolve';
          } else if (stage === 'resolve') {
            selectionCompleted = true;
            expect(selectedOids).toHaveLength(5);
            stage = 'destroy';
          }
        }
      }

      const evidence = `${trace.join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(paidOneBeforeCancel, evidence).toBe(true);
      expect(paymentRollback, evidence).toBe(true);
      expect(targetRollback, evidence).toBe(true);
      expect(inventedTargetRejected, evidence).toBe(true);
      expect(staleTargetRejected, evidence).toBe(true);
      expect(inventedLandRejected, evidence).toBe(true);
      expect(staleLandRejected, evidence).toBe(true);
      expect(zeroSelectionCompleted, evidence).toBe(true);
      expect(selectedOpposingLand, evidence).toBe(true);
      expect(selectionCompleted, evidence).toBe(true);
      expect(selectedLandsUntapped, evidence).toBe(true);
      expect(unselectedLandStayedTapped, evidence).toBe(true);
      expect(controlObserved, evidence).toBe(true);
      expect(controlRestored, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  420_000,
);
