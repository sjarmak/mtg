/** Installed-Forge outcomes for Cryptbreaker's two exact activated routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec, TableView } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(route: 'token' | 'draw'): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Cryptbreaker pilot',
        controller: 'local',
        deck: {
          name: `z5q4-cryptbreaker-${route}`,
          cards: [
            { name: 'Swamp', count: 30 },
            { name: 'Cryptbreaker', count: 15 },
            { name: 'Dread Wanderer', count: 15 },
          ],
        },
      },
      {
        name: 'Cryptbreaker opponent',
        controller: 'local',
        deck:
          route === 'token'
            ? { name: 'z5q4-cryptbreaker-token-opponent', cards: [{ name: 'Mountain', count: 60 }] }
            : {
                name: 'z5q4-cryptbreaker-draw-opponent',
                cards: [
                  { name: 'Swamp', count: 30 },
                  { name: 'Dread Wanderer', count: 30 },
                ],
              },
      },
    ],
    seed: `z5q4-reviewed-cryptbreaker-${route}-outcomes`,
    maximumTurns: 30,
  };
}

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
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

forgeIt(
  'cancels and then pays the exact discard route before creating the pinned Zombie',
  async () => {
    const spec = table('token');
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let sourceOid: string | undefined;
    let discardOid: string | undefined;
    let cancelBefore: unknown;
    let cancellationRolledBack = false;
    let attempt: 'cancel' | 'pay' | null = null;
    let paid = false;
    let inventedRejected = false;
    let staleRejected = false;
    let resolved = false;
    const trace: string[] = [];

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Cryptbreaker token decision');
        const pilot = session.view.seats[0];
        if (pilot.hand === null) throw new Error('Forge hid the local hand');
        const source = pilot.battlefield.find(
          (card) => card.oid === sourceOid || card.name === 'Cryptbreaker',
        );
        sourceOid ??= source?.oid;
        const zombie = pilot.battlefield.find(
          (card) =>
            card.oid !== sourceOid &&
            card.typeLine.includes('Creature') &&
            card.typeLine.includes('Zombie') &&
            card.power === 2 &&
            card.toughness === 2,
        );
        resolved ||=
          paid &&
          source?.tapped === true &&
          discardOid !== undefined &&
          pilot.graveyard.some((card) => card.oid === discardOid) &&
          zombie !== undefined &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        let staleSession: ObservedSession | null = null;
        let staleMove: string | null = null;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find(
            (option) =>
              option.id.startsWith('mana-source-') &&
              option.targets.some((target) => target.name === 'Swamp'),
          )?.id;
        } else if (decision.kind === 'cost-discard-selection') {
          const offered = decision.options
            .filter((option) => option.id.startsWith('cost-discard-') && option.id !== 'cost-discard-cancel')
            .flatMap((option) => option.targets.map((target) => target.oid))
            .sort();
          expect(offered).toEqual(pilot.hand.map((card) => card.oid).sort());
          expect(decision.options.some((option) => option.id === 'cost-discard-cancel')).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('cost-discard-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (attempt === 'cancel') {
            move = 'cost-discard-cancel';
          } else {
            const chosen = decision.options.find(
              (option) => option.id.startsWith('cost-discard-') && option.targets[0]?.name === 'Swamp',
            );
            discardOid = chosen?.targets[0]?.oid;
            move = chosen?.id;
            staleSession = session;
            staleMove = move ?? null;
          }
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) => option.id === 'discard-selection-commit')?.id;
          move ??= decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'priority') {
          const playLand = decision.options.find((option) => option.text === 'Play Swamp');
          const cast = decision.options.find(
            (option) => option.text.startsWith('Cryptbreaker:') && !option.text.includes('Create a 2/2'),
          );
          const activate = decision.options.find(
            (option) => option.text.startsWith('Cryptbreaker:') && option.text.includes('Create a 2/2'),
          );
          const untappedSwamps = pilot.battlefield.filter(
            (card) => card.name === 'Swamp' && !card.tapped,
          ).length;
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            playLand?.id ??
            (source === undefined ? cast?.id : undefined) ??
            (!paid && source?.tapped === false && untappedSwamps >= 2 && activate !== undefined
              ? activate.id
              : undefined);
          if (move === activate?.id) {
            attempt = cancellationRolledBack ? 'pay' : 'cancel';
            if (attempt === 'cancel') cancelBefore = publicPosition(session.view);
          }
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Cryptbreaker token move');
        const submittedFrom = session;
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
        if (attempt === 'cancel' && move === 'cost-discard-cancel') {
          expect(publicPosition(session.view)).toEqual(cancelBefore);
          cancellationRolledBack = true;
          attempt = null;
        } else if (attempt === 'pay' && move.startsWith('cost-discard-')) {
          paid = true;
          attempt = null;
        }
        if (staleSession !== null && staleMove !== null) {
          expect(staleSession).toBe(submittedFrom);
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(sourceOid, evidence).toMatch(/^forge-card-/u);
      expect(cancellationRolledBack, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(discardOid, evidence).toMatch(/^forge-card-/u);
      expect(resolved, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  360_000,
);

forgeIt(
  'offers only three exact untapped controlled Zombies, then draws one and loses one life',
  async () => {
    const spec = table('draw');
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let attackerOid: string | undefined;
    let attackCommitted = false;
    let cancelBefore: unknown;
    let attempt: 'cancel' | 'pay' | null = null;
    let cancellationRolledBack = false;
    let selected: readonly string[] = [];
    let paidOids: readonly string[] = [];
    let beforeHand = -1;
    let beforeLibrary = -1;
    let beforeLife = -1;
    let inventedRejected = false;
    let staleRejected = false;
    let resolved = false;
    const trace: string[] = [];

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Cryptbreaker draw decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (pilot.hand === null || opponent.hand === null) throw new Error('Forge hid a local hand');
        const source = pilot.battlefield.find((card) => card.name === 'Cryptbreaker');
        const pilotDreads = pilot.battlefield.filter((card) => card.name === 'Dread Wanderer');
        const opposingDread = opponent.battlefield.find((card) => card.name === 'Dread Wanderer');
        resolved ||=
          paidOids.length === 3 &&
          paidOids.every((oid) => pilot.battlefield.find((card) => card.oid === oid)?.tapped === true) &&
          pilot.handSize === beforeHand + 1 &&
          pilot.librarySize === beforeLibrary - 1 &&
          pilot.life === beforeLife - 1 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        let staleSession: ObservedSession | null = null;
        let staleMove: string | null = null;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'cost-tap-selection') {
          const currentCandidates = pilot.battlefield
            .filter(
              (card) =>
                card.typeLine.includes('Creature') &&
                card.typeLine.includes('Zombie') &&
                !card.tapped &&
                !selected.includes(card.oid),
            )
            .map((card) => card.oid)
            .sort();
          const offered = decision.options
            .filter((option) => option.id.startsWith('cost-tap-') && option.id !== 'cost-tap-cancel')
            .flatMap((option) => option.targets.map((target) => target.oid))
            .sort();
          const choiceEvidence = `${trace.slice(-80).join('\n')}\nview=${JSON.stringify(session.view)}`;
          expect(offered, choiceEvidence).toEqual(currentCandidates);
          expect(offered, choiceEvidence).not.toContain(attackerOid);
          expect(offered, choiceEvidence).not.toContain(opposingDread?.oid);
          expect(decision.options.some((option) => option.id === 'cost-tap-finish')).toBe(false);
          if (!inventedRejected) {
            await expect(session.submit('cost-tap-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            await expect(session.submit('cost-tap-finish')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (attempt === 'cancel' && selected.length === 1) {
            move = 'cost-tap-cancel';
          } else {
            const choice = decision.options.find(
              (option) =>
                option.id.startsWith('cost-tap-') && !selected.includes(option.targets[0]?.oid ?? ''),
            );
            const oid = choice?.targets[0]?.oid;
            if (oid !== undefined) selected = [...selected, oid];
            move = choice?.id;
            staleSession = session;
            staleMove = move ?? null;
          }
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) => option.id === 'discard-selection-commit')?.id;
          move ??= decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'combat-attackers') {
          const untappedPilotZombies = pilot.battlefield.filter(
            (card) => card.typeLine.includes('Creature') && card.typeLine.includes('Zombie') && !card.tapped,
          );
          if (
            decision.seat === 0 &&
            source !== undefined &&
            pilotDreads.length >= 3 &&
            untappedPilotZombies.length >= 4 &&
            opposingDread !== undefined &&
            attackerOid === undefined
          ) {
            const add = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === pilotDreads[0]?.oid,
            );
            attackerOid = add?.targets[0]?.oid;
            move = add?.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            if (decision.seat === 0 && attackerOid !== undefined) attackCommitted = true;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const seat = session.view.seats[decision.seat];
          const playLand = decision.options.find((option) => option.text === 'Play Swamp');
          const canPayBlack = seat?.battlefield.some((card) => card.name === 'Swamp' && !card.tapped);
          const castCryptbreaker = decision.options.find(
            (option) => option.text.startsWith('Cryptbreaker:') && !option.text.includes('Create a 2/2'),
          );
          const castDread = decision.options.find((option) => option.text.startsWith('Dread Wanderer:'));
          const draw = decision.options.find(
            (option) => option.text.startsWith('Cryptbreaker:') && option.text.includes('draw a card'),
          );
          const localSetup = source !== undefined && pilotDreads.length >= 3;
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            playLand?.id ??
            (decision.seat === 0 && source === undefined && canPayBlack ? castCryptbreaker?.id : undefined) ??
            (decision.seat === 0 && pilotDreads.length < 3 && canPayBlack ? castDread?.id : undefined) ??
            (decision.seat === 1 && opposingDread === undefined && canPayBlack ? castDread?.id : undefined) ??
            (decision.seat === 0 &&
            localSetup &&
            opposingDread !== undefined &&
            attackCommitted &&
            session.view.turn.step === 'MAIN2' &&
            paidOids.length === 0
              ? draw?.id
              : undefined);
          if (move === draw?.id) {
            attempt = cancellationRolledBack ? 'pay' : 'cancel';
            selected = [];
            if (attempt === 'cancel') cancelBefore = publicPosition(session.view);
            else {
              beforeHand = pilot.handSize;
              beforeLibrary = pilot.librarySize;
              beforeLife = pilot.life;
            }
          }
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Cryptbreaker draw move');
        const submittedFrom = session;
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
        session = advanced.session;
        if (attempt === 'cancel' && move === 'cost-tap-cancel') {
          expect(publicPosition(session.view)).toEqual(cancelBefore);
          cancellationRolledBack = true;
          attempt = null;
          selected = [];
        } else if (attempt === 'pay' && selected.length === 3 && move.startsWith('cost-tap-')) {
          paidOids = [...selected];
          attempt = null;
        }
        if (staleSession !== null && staleMove !== null) {
          expect(staleSession).toBe(submittedFrom);
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
      }

      const evidence = `${trace.slice(-520).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(attackerOid, evidence).toBeDefined();
      expect(attackerOid).toMatch(/^forge-card-/u);
      expect(cancellationRolledBack, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(new Set(paidOids).size, evidence).toBe(3);
      expect(resolved, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  480_000,
);
