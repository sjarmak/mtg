/** Installed-Forge outcomes for Myr Battlesphere's exact entry and attack routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec, TableView } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Myr Battlesphere pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-myr-battlesphere-outcomes',
        cards: [
          { name: 'Swamp', count: 42 },
          { name: 'Myr Battlesphere', count: 10 },
          { name: 'Dread Wanderer', count: 8 },
        ],
      },
    },
    {
      name: 'Myr Battlesphere opponent',
      controller: 'local',
      deck: {
        name: 'z5q4-myr-battlesphere-opponent',
        cards: [
          { name: 'Mountain', count: 45 },
          { name: 'Myr Battlesphere', count: 15 },
        ],
      },
    },
  ],
  seed: 'z5q4-reviewed-myr-battlesphere-outcomes',
  maximumTurns: 40,
};

function publicPosition(view: TableView): unknown {
  return {
    turn: view.turn,
    priority: view.priority,
    stack: view.stack,
    seats: view.seats.map((seat) => ({
      life: seat.life,
      hand: seat.hand,
      handSize: seat.handSize,
      librarySize: seat.librarySize,
      graveyard: seat.graveyard,
      exile: seat.exile,
      battlefield: seat.battlefield,
    })),
  };
}

function routineMove(session: ObservedSession): string | undefined {
  const decision = session.decision;
  if (decision === null) return undefined;
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      (decision.kind === 'priority' && option.text === 'Pass priority') ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

forgeIt(
  'creates four pinned Myr, declines and cancels safely, then taps exact X for pump and defender damage',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(TABLE)).toEqual([]);
    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let sourceOid: string | undefined;
    let tokenOids: readonly string[] = [];
    let attackTrigger = 0;
    let selected: readonly string[] = [];
    let canceledSelectedOid: string | undefined;
    let successfulLifeBefore = -1;
    let declineLifeBefore = -1;
    let declinePosition: unknown;
    let declinedWithoutEffect = false;
    let cancellationRolledBack = false;
    let inventedNumberRejected = false;
    let outOfRangeRejected = false;
    let inventedTapRejected = false;
    let staleTapRejected = false;
    let resolved = false;
    const trace: string[] = [];

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Myr Battlesphere decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (pilot.hand === null || opponent.hand === null) throw new Error('Forge hid a local hand');
        const source = pilot.battlefield.find(
          (card) => card.oid === sourceOid || card.name === 'Myr Battlesphere',
        );
        sourceOid ??= source?.oid;
        const exactTokens = pilot.battlefield.filter(
          (card) =>
            card.oid !== sourceOid &&
            card.typeLine.includes('Artifact') &&
            card.typeLine.includes('Creature') &&
            card.typeLine.includes('Myr') &&
            card.power === 1 &&
            card.toughness === 1,
        );
        if (source !== undefined && session.view.stack.length === 0 && tokenOids.length === 0) {
          expect(exactTokens).toHaveLength(4);
          tokenOids = exactTokens.map((card) => card.oid).sort();
          expect(new Set(tokenOids).size).toBe(4);
        }
        if (
          attackTrigger >= 1 &&
          attackTrigger < 2 &&
          declinePosition !== undefined &&
          !declinedWithoutEffect &&
          decision.kind === 'priority'
        ) {
          expect(opponent.life).toBe(declineLifeBefore);
          expect(source?.power).toBe(4);
          expect(exactTokens.every((card) => !card.tapped)).toBe(true);
          declinedWithoutEffect = true;
        }
        if (
          canceledSelectedOid !== undefined &&
          attackTrigger === 2 &&
          decision.kind === 'priority' &&
          source !== undefined
        ) {
          expect(pilot.battlefield.find((card) => card.oid === canceledSelectedOid)?.tapped).toBe(false);
          expect(source.power).toBe(4);
          cancellationRolledBack = true;
        }
        resolved ||=
          attackTrigger >= 3 &&
          successfulLifeBefore >= 0 &&
          selected.length === 3 &&
          selected.every((oid) => pilot.battlefield.find((card) => card.oid === oid)?.tapped === true) &&
          source?.power === 7 &&
          opponent.life === successfulLifeBefore - 3;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        let staleSession: ObservedSession | null = null;
        let staleMove: string | null = null;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Myr Battlesphere:')) {
          attackTrigger += 1;
          selected = [];
          if (attackTrigger === 1) {
            declinePosition = publicPosition(session.view);
            declineLifeBefore = opponent.life;
            move = decision.options.find((option) => option.id === 'confirm-trigger-no')?.id;
          } else {
            move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          }
        } else if (decision.kind === 'number' && decision.seat === 0) {
          const ids = decision.options.map((option) => option.id).sort();
          expect(ids).toEqual(['number-0', 'number-1', 'number-2', 'number-3', 'number-4']);
          if (!inventedNumberRejected) {
            await expect(session.submit('number-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedNumberRejected = true;
          }
          if (!outOfRangeRejected) {
            await expect(session.submit('number-5')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            outOfRangeRejected = true;
          }
          if (attackTrigger >= 3) successfulLifeBefore = opponent.life;
          move = attackTrigger === 2 ? 'number-2' : 'number-3';
        } else if (decision.kind === 'cost-tap-selection') {
          const currentCandidates = pilot.battlefield
            .filter(
              (card) =>
                card.typeLine.includes('Creature') &&
                card.typeLine.includes('Myr') &&
                !card.tapped &&
                !selected.includes(card.oid),
            )
            .map((card) => card.oid)
            .sort();
          const offered = decision.options
            .filter((option) => option.id.startsWith('cost-tap-') && option.id !== 'cost-tap-cancel')
            .flatMap((option) => option.targets.map((target) => target.oid))
            .sort();
          const choiceEvidence = `${trace.slice(-120).join('\n')}\nview=${JSON.stringify(session.view)}`;
          expect(offered, choiceEvidence).toEqual(currentCandidates);
          expect(offered, choiceEvidence).not.toContain(sourceOid);
          expect(
            offered.every((oid) => tokenOids.includes(oid)),
            choiceEvidence,
          ).toBe(true);
          expect(
            offered.every((oid) => !opponent.battlefield.some((card) => card.oid === oid)),
            choiceEvidence,
          ).toBe(true);
          expect(decision.options.some((option) => option.id === 'cost-tap-finish')).toBe(false);
          if (!inventedTapRejected) {
            await expect(session.submit('cost-tap-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            await expect(session.submit('cost-tap-finish')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedTapRejected = true;
          }
          if (attackTrigger === 2 && selected.length === 1) {
            canceledSelectedOid = selected[0];
            move = 'cost-tap-cancel';
            selected = [];
          } else {
            const choice = decision.options.find(
              (option) =>
                option.id.startsWith('cost-tap-') && !selected.includes(option.targets[0]?.oid ?? ''),
            );
            const oid = choice?.targets[0]?.oid;
            if (oid !== undefined) selected = [...selected, oid];
            move = choice?.id;
            if (attackTrigger >= 3 && selected.length === 1) {
              staleSession = session;
              staleMove = move ?? null;
            }
          }
        } else if (decision.kind === 'combat-attackers') {
          if (
            decision.seat === 0 &&
            sourceOid !== undefined &&
            tokenOids.length === 4 &&
            pilot.battlefield.some((card) => card.name === 'Dread Wanderer') &&
            opponent.battlefield.some((card) => card.name === 'Myr Battlesphere') &&
            attackTrigger < 3
          ) {
            move = decision.options.find(
              (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === sourceOid,
            )?.id;
          }
          move ??= decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const seat = session.view.seats[decision.seat];
          const basic = decision.seat === 0 ? 'Swamp' : 'Mountain';
          const playLand = decision.options.find((option) => option.text === `Play ${basic}`);
          const ownBattlesphere = seat?.battlefield.some((card) => card.name === 'Myr Battlesphere');
          const untappedBasics =
            seat?.battlefield.filter((card) => card.name === basic && !card.tapped).length ?? 0;
          const castBattlesphere = decision.options.find((option) =>
            option.text.startsWith('Myr Battlesphere:'),
          );
          const castDread = decision.options.find((option) => option.text.startsWith('Dread Wanderer:'));
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            playLand?.id ??
            (decision.seat === 0 &&
            !pilot.battlefield.some((card) => card.name === 'Dread Wanderer') &&
            untappedBasics >= 1 &&
            castDread !== undefined
              ? castDread.id
              : undefined) ??
            (!ownBattlesphere && untappedBasics >= 7 ? castBattlesphere?.id : undefined);
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Myr Battlesphere move');
        const submittedFrom = session;
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-260).join('\n')}`);
        session = advanced.session;
        if (staleSession !== null && staleMove !== null) {
          expect(staleSession).toBe(submittedFrom);
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleTapRejected = true;
        }
      }

      const evidence = `${trace.slice(-620).join('\n')}\nview=${JSON.stringify(session.view)}`;
      if (sourceOid === undefined) throw new Error(evidence);
      expect(sourceOid, evidence).toMatch(/^forge-card-/u);
      expect(tokenOids, evidence).toHaveLength(4);
      expect(declinedWithoutEffect, evidence).toBe(true);
      expect(cancellationRolledBack, evidence).toBe(true);
      expect(inventedNumberRejected, evidence).toBe(true);
      expect(outOfRangeRejected, evidence).toBe(true);
      expect(inventedTapRejected, evidence).toBe(true);
      expect(staleTapRejected, evidence).toBe(true);
      expect(new Set(selected).size, evidence).toBe(3);
      expect(resolved, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  360_000,
);
