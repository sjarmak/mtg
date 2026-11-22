/** Exact two-seat Fact or Fiction partition and final-zone outcome in installed Forge. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Fact caster',
      controller: 'local',
      deck: {
        name: 'fact-or-fiction-caster',
        cards: [
          { name: 'Island', count: 48 },
          { name: 'Fact or Fiction', count: 12 },
        ],
      },
    },
    {
      name: 'Pile separator',
      controller: 'local',
      deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'reviewed-fact-or-fiction-two-piles-outcome',
  maximumTurns: 20,
};

forgeIt(
  'Fact or Fiction lets the opponent partition five exact objects and the caster choose their final zones',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let castAttempts = 0;
    let canceled = false;
    let canceledFactOid: string | undefined;
    let canceledUntapped = 0;
    let inventedPartitionRejected = false;
    let stalePartitionRejected = false;
    let inventedPileRejected = false;
    let partitionCandidates: readonly string[] = [];
    let firstPile: readonly string[] = [];
    let firstPartitionMoveId: string | undefined;
    let selectedPile: readonly string[] = [];
    let rejectedPile: readonly string[] = [];
    let resolved = false;
    const trace: string[] = [];
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let moves = 0; session.status === 'awaiting' && moves < 1_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Forge decision');
        const caster = session.view.seats[0];
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        if (castAttempts === 1 && !canceled && decision.kind === 'priority') {
          expect(session.view.stack.some((card) => card.name === 'Fact or Fiction')).toBe(false);
          expect(caster.hand?.some((card) => card.oid === canceledFactOid)).toBe(true);
          expect(caster.battlefield.filter((card) => card.name === 'Island' && !card.tapped)).toHaveLength(
            canceledUntapped,
          );
          canceled = true;
        }
        if (selectedPile.length > 0) {
          const selectedInHand = selectedPile.every((oid) => caster.hand?.some((card) => card.oid === oid));
          const rejectedInGraveyard = rejectedPile.every((oid) =>
            caster.graveyard.some((card) => card.oid === oid),
          );
          resolved ||= selectedInHand && rejectedInGraveyard;
        }

        let move = decision.options.find(
          (option) =>
            option.text === 'Play first' ||
            option.text === 'Keep this hand' ||
            option.text === 'Pass priority' ||
            option.id === 'combat-attackers-commit' ||
            option.id === 'combat-blockers-commit',
        )?.id;

        if (decision.kind === 'mana-payment') {
          if (castAttempts === 1) {
            move = decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
          } else {
            move = decision.options.find(
              (option) =>
                option.id.startsWith('mana-source-') &&
                option.targets.some((target) => target.name === 'Island'),
            )?.id;
          }
        } else if (decision.kind === 'discard-selection' || decision.kind === 'hand-card-selection') {
          move =
            decision.options.find((option) => option.id.endsWith('-commit'))?.id ??
            decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'card-selection') {
          expect(decision.seat).toBe(1);
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          if (partitionCandidates.length === 0) {
            partitionCandidates = candidates.flatMap((option) => option.targets.map((target) => target.oid));
            expect(partitionCandidates).toHaveLength(5);
            const invented = await session.submit('fact-partition-invented');
            expect(invented.ok).toBe(false);
            inventedPartitionRejected = true;
          }
          if (firstPile.length < 2) {
            const next = candidates.find((option) => !firstPile.includes(option.targets[0]?.oid ?? ''));
            const oid = next?.targets[0]?.oid;
            if (next === undefined || oid === undefined) throw new Error('Missing partition candidate');
            if (firstPile.length === 1) {
              if (firstPartitionMoveId === undefined) throw new Error('Missing prior partition move');
              const stale = await session.submit(firstPartitionMoveId);
              expect(stale.ok).toBe(false);
              stalePartitionRejected = true;
            }
            firstPile = [...firstPile, oid];
            firstPartitionMoveId ??= next.id;
            move = next.id;
          } else {
            move = decision.options.find((option) => option.id === 'card-selection-done')?.id;
          }
        } else if (decision.kind === 'choose-pile') {
          expect(decision.seat).toBe(0);
          expect(decision.options).toHaveLength(2);
          const first = decision.options.find((option) => option.id === 'choose-pile-first');
          const second = decision.options.find((option) => option.id === 'choose-pile-second');
          if (first === undefined || second === undefined) throw new Error('Missing exact pile choices');
          expect(first.targets.map((target) => target.oid)).toEqual(firstPile);
          expect(new Set([...first.targets, ...second.targets].map((target) => target.oid))).toEqual(
            new Set(partitionCandidates),
          );
          const invented = await session.submit('fact-pile-invented');
          expect(invented.ok).toBe(false);
          inventedPileRejected = true;
          selectedPile = first.targets.map((target) => target.oid);
          rejectedPile = second.targets.map((target) => target.oid);
          move = first.id;
        } else if (decision.kind === 'priority') {
          if (resolved) {
            move = decision.options.find((option) => option.text === 'Concede')?.id;
          } else {
            move =
              decision.options.find(
                (option) => option.text === (decision.seat === 0 ? 'Play Island' : 'Play Mountain'),
              )?.id ?? move;
            if (decision.seat === 0) {
              const untapped = caster.battlefield.filter(
                (card) => card.name === 'Island' && !card.tapped,
              ).length;
              if (
                untapped >= 4 &&
                castAttempts < 2 &&
                !session.view.stack.some((card) => card.name === 'Fact or Fiction')
              ) {
                const cast = decision.options.find((option) => option.text.startsWith('Fact or Fiction:'));
                if (cast !== undefined) {
                  castAttempts += 1;
                  if (castAttempts === 1) {
                    canceledFactOid = caster.hand?.find((card) => card.name === 'Fact or Fiction')?.oid;
                    canceledUntapped = untapped;
                  }
                  move = cast.id;
                }
              }
            }
          }
        }
        if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(castAttempts).toBe(2);
      expect(canceled).toBe(true);
      expect(inventedPartitionRejected).toBe(true);
      expect(stalePartitionRejected).toBe(true);
      expect(inventedPileRejected).toBe(true);
      expect(firstPile).toHaveLength(2);
      expect(selectedPile).toEqual(firstPile);
      expect(rejectedPile).toHaveLength(3);
      expect(resolved).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-120).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  420_000,
);
