/** Installed-Forge outcomes for Prismari Command's exact two-distinct-mode composition. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Prismari Command pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-prismari-command-outcomes',
        cards: [
          { name: 'Volcanic Island', count: 30 },
          { name: 'Prismari Command', count: 30 },
        ],
      },
    },
    {
      name: 'Prismari Command artifact target',
      controller: 'local',
      deck: {
        name: 'z5q4-prismari-command-artifact',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Relic of Progenitus', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-prismari-command-all-four-modes',
  maximumTurns: 24,
};

function traceDecision(session: ObservedSession): string {
  const decision = session.decision;
  if (decision === null) return 'no decision';
  return `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
}

function routineMove(decision: ObservedDecision): string | undefined {
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

function untapped(session: ObservedSession, seat: number, name: string): number {
  return session.view.seats[seat]!.battlefield.filter((card) => card.name === name && !card.tapped).length;
}

forgeIt(
  'runs all four modes, exact targets and discard identities with hostile and rollback probes',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let resolvedCasts = 0;
    const resolvedCastOids = new Set<string>();
    let activeCastOid: string | undefined;
    let selectedModes: string[] = [];
    let castAttempts = 0;
    let canceled = false;
    let rollbackObserved = false;
    let cancellationHandOid: string | undefined;
    let cancellationLands: ReadonlyMap<string, boolean> = new Map();
    let inventedModeRejected = false;
    let staleModeRejected = false;
    let inventedTargetRejected = false;
    let staleTargetRejected = false;
    let inventedDiscardRejected = false;
    let staleDiscardRejected = false;
    let shockLifeBefore = -1;
    let lootLibraryBefore = -1;
    let relicOid: string | undefined;
    const discardedOids: string[] = [];
    let treasureOid: string | undefined;
    let outcome = false;
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Prismari Command decision');
        const pilot = session.view.seats[0]!;
        const opponent = session.view.seats[1]!;
        if (pilot.hand === null || opponent.hand === null) {
          throw new Error('Forge hid a local Prismari Command hand');
        }
        relicOid ??= opponent.battlefield.find((card) => card.name === 'Relic of Progenitus')?.oid;
        treasureOid ??= pilot.battlefield.find(
          (card) => card.name.includes('Treasure') && card.typeLine.includes('Artifact'),
        )?.oid;
        if (activeCastOid !== undefined && pilot.graveyard.some((card) => card.oid === activeCastOid)) {
          resolvedCastOids.add(activeCastOid);
          resolvedCasts = resolvedCastOids.size;
          activeCastOid = undefined;
          selectedModes = [];
        }
        outcome =
          resolvedCasts === 2 &&
          shockLifeBefore >= 0 &&
          opponent.life === shockLifeBefore - 2 &&
          treasureOid !== undefined &&
          pilot.battlefield.some(
            (card) =>
              card.oid === treasureOid &&
              card.name.includes('Treasure') &&
              card.typeLine.includes('Artifact'),
          ) &&
          lootLibraryBefore >= 0 &&
          pilot.librarySize === lootLibraryBefore - 2 &&
          discardedOids.length === 2 &&
          discardedOids.every((oid) => pilot.graveyard.some((card) => card.oid === oid)) &&
          relicOid !== undefined &&
          opponent.graveyard.some((card) => card.oid === relicOid) &&
          !opponent.battlefield.some((card) => card.oid === relicOid) &&
          session.view.stack.length === 0;
        trace.push(traceDecision(session));

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'mode-selection' && activeCastOid !== undefined) {
          const firstPick = selectedModes.length === 0;
          expect(decision.options, trace.at(-1)).toHaveLength(firstPick ? 4 : 3);
          const desired =
            resolvedCasts === 0
              ? firstPick
                ? 'deals 2 damage'
                : 'creates a Treasure'
              : firstPick
                ? 'draws two cards'
                : 'Destroy target artifact';
          const selected = decision.options.find((option) => option.text.includes(desired));
          expect(selected, trace.at(-1)).toBeDefined();
          expect(
            decision.options.some((option) => selectedModes.some((chosen) => option.text.includes(chosen))),
            trace.at(-1),
          ).toBe(false);
          if (!inventedModeRejected) {
            await expect(session.submit('mode-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedModeRejected = true;
          }
          selectedModes.push(desired);
          const stale = session;
          const advanced = await session.submit(selected!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          if (!staleModeRejected) {
            await expect(stale.submit(selected!.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleModeRejected = true;
          }
          session = advanced.session;
          continue;
        } else if (
          (decision.kind === 'target-selection' || decision.kind === 'repeatable-target-selection') &&
          activeCastOid !== undefined
        ) {
          const targets = decision.options.filter((option) => option.id !== 'target-cancel');
          if (!inventedTargetRejected) {
            await expect(session.submit('target-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedTargetRejected = true;
          }
          if (!canceled) {
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            const advanced = await session.submit(cancel!.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            canceled = true;
            const restored = session.view.seats[0]!;
            rollbackObserved =
              cancellationHandOid !== undefined &&
              restored.hand?.some((card) => card.oid === cancellationHandOid) === true &&
              restored.battlefield
                .filter((card) => cancellationLands.has(card.oid))
                .every((card) => card.tapped === cancellationLands.get(card.oid)) &&
              session.view.seats[1]!.battlefield.some((card) => card.oid === relicOid);
            activeCastOid = undefined;
            selectedModes = [];
            continue;
          }

          let selected: (typeof targets)[number] | undefined;
          if (decision.prompt.includes('deal 2 damage')) {
            expect(new Set(targets.map((option) => option.id))).toContain('target-player-1');
            selected = targets.find((option) => option.id === 'target-player-1');
            shockLifeBefore = opponent.life;
          } else if (decision.prompt.includes('create a Treasure')) {
            expect(new Set(targets.map((option) => option.id))).toEqual(
              new Set(['target-player-0', 'target-player-1']),
            );
            selected = targets.find((option) => option.id === 'target-player-0');
          } else if (decision.prompt.includes('draw two cards')) {
            expect(new Set(targets.map((option) => option.id))).toEqual(
              new Set(['target-player-0', 'target-player-1']),
            );
            selected = targets.find((option) => option.id === 'target-player-0');
            lootLibraryBefore = pilot.librarySize;
          } else if (decision.prompt.includes('artifact to destroy')) {
            const liveArtifacts = [...pilot.battlefield, ...opponent.battlefield]
              .filter((card) => card.typeLine.includes('Artifact'))
              .map((card) => card.oid);
            expect(new Set(targets.map((option) => option.targets[0]!.oid))).toEqual(new Set(liveArtifacts));
            selected = targets.find((option) => option.targets[0]!.oid === relicOid);
          }
          expect(selected, trace.at(-1)).toBeDefined();
          const stale = session;
          const advanced = await session.submit(selected!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          if (!staleTargetRejected) {
            await expect(stale.submit(selected!.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleTargetRejected = true;
          }
          session = advanced.session;
          continue;
        } else if (decision.kind === 'hand-card-selection') {
          const cards = decision.options.filter((option) => option.targets.length === 1);
          expect(cards.length, trace.at(-1)).toBeGreaterThanOrEqual(1);
          expect(
            cards.every((option) => pilot.hand!.some((card) => card.oid === option.targets[0]!.oid)),
            trace.at(-1),
          ).toBe(true);
          if (!inventedDiscardRejected) {
            await expect(session.submit('hand-card-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedDiscardRejected = true;
          }
          const selected = cards.find((option) => !discardedOids.includes(option.targets[0]!.oid));
          expect(selected, trace.at(-1)).toBeDefined();
          discardedOids.push(selected!.targets[0]!.oid);
          const stale = session;
          const advanced = await session.submit(selected!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          if (!staleDiscardRejected) {
            await expect(stale.submit(selected!.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleDiscardRejected = true;
          }
          session = advanced.session;
          continue;
        } else if (decision.kind === 'priority') {
          const castRelic = decision.options.find((option) => option.text.startsWith('Relic of Progenitus:'));
          const castPrismari = decision.options.find((option) => option.text.startsWith('Prismari Command:'));
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Volcanic Island')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 1 && relicOid === undefined && untapped(session, 1, 'Mountain') >= 1
              ? castRelic?.id
              : undefined) ??
            (decision.seat === 0 &&
            resolvedCasts < 2 &&
            activeCastOid === undefined &&
            relicOid !== undefined &&
            untapped(session, 0, 'Volcanic Island') >= 3
              ? castPrismari?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castPrismari !== undefined && move === castPrismari.id) {
            const sourceNumber = /^ability-(\d+)-/u.exec(castPrismari.id)?.[1];
            const sourceOid = sourceNumber === undefined ? undefined : `forge-card-${sourceNumber}`;
            const source = pilot.hand.find((card) => card.oid === sourceOid);
            expect(source, trace.at(-1)).toBeDefined();
            activeCastOid = source!.oid;
            castAttempts += 1;
            selectedModes = [];
            if (!canceled) {
              cancellationHandOid = source!.oid;
              cancellationLands = new Map(
                pilot.battlefield
                  .filter((card) => card.name === 'Volcanic Island')
                  .map((card) => [card.oid, card.tapped]),
              );
            }
          }
        }

        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Prismari Command move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-400).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(castAttempts, evidence).toBe(3);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(inventedModeRejected, evidence).toBe(true);
      expect(staleModeRejected, evidence).toBe(true);
      expect(inventedTargetRejected, evidence).toBe(true);
      expect(staleTargetRejected, evidence).toBe(true);
      expect(inventedDiscardRejected, evidence).toBe(true);
      expect(staleDiscardRejected, evidence).toBe(true);
      expect(discardedOids, evidence).toHaveLength(2);
      expect(treasureOid, evidence).toMatch(/^forge-card-/u);
      expect(relicOid, evidence).toMatch(/^forge-card-/u);
      expect(outcome, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  480_000,
);
