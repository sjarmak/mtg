/** Installed-Forge proof for Ponder and Portent's exact reorder-or-shuffle routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;
type CardName = 'Ponder' | 'Portent';

function table(cardName: CardName, shuffle: boolean): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `${cardName} ${shuffle ? 'shuffle' : 'keep-order'} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-${cardName.toLowerCase()}-${shuffle ? 'shuffle' : 'keep'}`,
          cards: [
            { name: 'Island', count: 30 },
            { name: cardName, count: 30 },
          ],
        },
      },
      {
        name: `${cardName} target`,
        controller: 'local',
        deck: {
          name: `z5q4-${cardName.toLowerCase()}-target-${shuffle ? 'shuffle' : 'keep'}`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Mother of Runes', count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-${cardName.toLowerCase()}-${shuffle ? 'shuffle' : 'keep'}-outcome`,
    maximumTurns: 8,
  };
}

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
      option.id === 'combat-blockers-commit',
  )?.id;
}

async function proveRoute(cardName: CardName, shuffle: boolean): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = table(cardName, shuffle);
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let castAttempts = 0;
  let canceled = false;
  let cancellationRestored = false;
  let inventedRejected = false;
  let staleRejected = false;
  let orderedTopOid: string | undefined;
  let orderMenus: number[] = [];
  let confirmed = false;
  let resolvedCasterHand: number | undefined;
  let resolvedTargetHand: number | undefined;
  let casterHandAtConfirmation: number | undefined;
  let targetHandAtConfirmation: number | undefined;
  let immediateOutcome = false;
  let delayedOutcome = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error(`Forge offered no ${cardName} decision`);
      const caster = session.view.seats[0];
      const target = session.view.seats[1];
      const resolved =
        castAttempts >= 2 &&
        confirmed &&
        session.view.stack.length === 0 &&
        caster.graveyard.some((card) => card.name === cardName);
      if (resolved && resolvedCasterHand === undefined) {
        resolvedCasterHand = caster.handSize;
        resolvedTargetHand = target.handSize;
        if (cardName === 'Ponder') {
          immediateOutcome =
            orderedTopOid !== undefined &&
            (shuffle
              ? !(caster.hand ?? []).some((card) => card.oid === orderedTopOid)
              : (caster.hand ?? []).some((card) => card.oid === orderedTopOid));
        }
      }
      if (cardName === 'Portent' && resolvedCasterHand !== undefined && resolvedTargetHand !== undefined) {
        const casterDrew = caster.handSize > resolvedCasterHand;
        const targetDrew = target.handSize > resolvedTargetHand;
        const targetOrderObserved =
          orderedTopOid !== undefined &&
          (shuffle
            ? !(target.hand ?? []).some((card) => card.oid === orderedTopOid)
            : (target.hand ?? []).some((card) => card.oid === orderedTopOid));
        delayedOutcome ||= casterDrew && targetDrew && targetOrderObserved;
      }
      const complete = cardName === 'Ponder' ? immediateOutcome : delayedOutcome;
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move = routineMove(decision);
      if (decision.kind === 'target-selection' && decision.seat === 0 && cardName === 'Portent') {
        if (!canceled) {
          move = decision.options.find((option) => option.id === 'target-cancel')?.id;
          canceled = move !== undefined;
        } else {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        }
      } else if (
        decision.kind === 'mana-payment' &&
        decision.seat === 0 &&
        cardName === 'Ponder' &&
        !canceled
      ) {
        move = decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
        canceled = move !== undefined;
      } else if (
        (decision.kind === 'zone-order' || decision.kind === 'zone-order-library-top-first') &&
        decision.seat === 0
      ) {
        orderMenus = [...orderMenus, decision.options.length];
        const pick = decision.options[0];
        if (pick === undefined) throw new Error(`${cardName} ordering was empty`);
        if (orderedTopOid === undefined) {
          expect(decision.options).toHaveLength(3);
          orderedTopOid = pick.targets[0]?.oid;
          expect(orderedTopOid).toBeDefined();
          await expect(session.submit('zone-order-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        move = pick.id;
      } else if (
        (decision.kind === 'confirm-action' || decision.kind === 'confirm-library-shuffle-after-order') &&
        decision.seat === 0
      ) {
        expect(decision.prompt).toContain('shuffle');
        const confirmIds =
          decision.kind === 'confirm-library-shuffle-after-order'
            ? ['confirm-library-shuffle-after-order-yes', 'confirm-library-shuffle-after-order-no']
            : ['confirm-action-yes', 'confirm-action-no'];
        expect(decision.options.map((option) => option.id)).toEqual(confirmIds);
        casterHandAtConfirmation = caster.handSize;
        targetHandAtConfirmation = target.handSize;
        move = shuffle ? confirmIds[0] : confirmIds[1];
        confirmed = true;
      } else if (decision.kind === 'priority') {
        if (complete) {
          move = decision.options.find((option) => option.text === 'Concede')?.id;
        } else if (decision.seat === 0) {
          const island = decision.options.find((option) => option.text === 'Play Island')?.id;
          const cast =
            caster.battlefield.some((card) => card.name === 'Island' && !card.tapped) && !confirmed
              ? decision.options.find((option) => option.text.startsWith(`${cardName}:`))?.id
              : undefined;
          move = island ?? cast ?? decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move !== undefined && move === cast) castAttempts += 1;
        } else {
          move = decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error(`Forge offered no ${cardName} move`);
      const stale =
        (decision.kind === 'zone-order' || decision.kind === 'zone-order-library-top-first') &&
        staleRejected === false
          ? move
          : undefined;
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
      session = advanced.session;
      if (stale !== undefined) {
        await expect(session.submit(stale)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'unknown-move' },
        });
        staleRejected = true;
      }
      if (canceled && !cancellationRestored && !confirmed && session.view.stack.length === 0) {
        const restored = session.view.seats[0];
        cancellationRestored =
          (restored.hand ?? []).some((card) => card.name === cardName) &&
          restored.battlefield.some((card) => card.name === 'Island' && !card.tapped);
      }
    }
    const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(castAttempts, evidence).toBe(2);
    expect(canceled, evidence).toBe(true);
    expect(cancellationRestored, evidence).toBe(true);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(orderMenus.slice(0, 2), evidence).toEqual([3, 2]);
    expect(confirmed, evidence).toBe(true);
    expect(casterHandAtConfirmation, evidence).toBeDefined();
    expect(targetHandAtConfirmation, evidence).toBeDefined();
    if (cardName === 'Ponder') {
      expect(immediateOutcome, evidence).toBe(true);
      expect(resolvedCasterHand, evidence).toBe((casterHandAtConfirmation ?? 0) + 1);
    } else {
      expect(resolvedCasterHand, evidence).toBe(casterHandAtConfirmation);
      expect(resolvedTargetHand, evidence).toBe(targetHandAtConfirmation);
      expect(delayedOutcome, evidence).toBe(true);
    }
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'proves exact ordering, both shuffle choices, draw timing, target ownership, and refusal',
  async () => {
    const routes = [
      ['Ponder', false],
      ['Ponder', true],
      ['Portent', false],
      ['Portent', true],
    ] as const;
    for (let index = 0; index < routes.length; index += 2) {
      await Promise.all(
        routes.slice(index, index + 2).map(([cardName, shuffle]) => proveRoute(cardName, shuffle)),
      );
    }
  },
  420_000,
);
