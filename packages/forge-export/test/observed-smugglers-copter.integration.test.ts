/** Installed-Forge proof for Smuggler's Copter's exact Crew and combat-loot routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec, TableView } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

type Route = 'attack' | 'block';

function table(route: Route): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Copter pilot',
        controller: 'local',
        deck: {
          name: `z5q4-smugglers-copter-${route}`,
          cards: [
            { name: 'Mountain', count: 30 },
            { name: 'Firedrinker Satyr', count: 15 },
            { name: "Smuggler's Copter", count: 15 },
          ],
        },
      },
      {
        name: route === 'attack' ? 'Copter observer' : 'Copter attacker',
        controller: 'local',
        deck:
          route === 'attack'
            ? { name: 'z5q4-copter-observer', cards: [{ name: 'Mountain', count: 60 }] }
            : {
                name: 'z5q4-copter-attacker',
                cards: [
                  { name: 'Mountain', count: 30 },
                  { name: 'Firedrinker Satyr', count: 30 },
                ],
              },
      },
    ],
    seed: `z5q4-smugglers-copter-${route}-outcomes`,
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

forgeIt.each(['attack', 'block'] as const)(
  'crews exactly, then proves the %s combat-loot route through real board outcomes',
  async (route) => {
    const spec = table(route);
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let copterOid: string | null = null;
    let copterEnteredTurn: number | null = null;
    let crewCandidateOid: string | null = null;
    let crewAttempt: 'cancel' | 'pay' | null = null;
    let crewCandidateChosen = false;
    let cancelBefore: unknown = null;
    let cancellationRolledBack = false;
    let crewPaid = false;
    let crewResolved = false;
    let crewInventedRejected = false;
    let crewStaleRejected = false;
    let attackerAdded = false;
    let blockerAdded = false;
    let triggerOffered = false;
    let triggerInventedRejected = false;
    let triggerStaleRejected = false;
    let triggerHand = -1;
    let triggerLibrary = -1;
    let declinedWithoutChange = false;
    let triggerAccepted = false;
    let drawBeforeDiscard = false;
    let discardOid: string | null = null;
    let discardInventedRejected = false;
    let discardStaleRejected = false;
    let discardObserved = false;

    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error("Forge offered no Smuggler's Copter decision");
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (pilot.hand === null || opponent.hand === null) throw new Error('Forge hid a local hand');
        copterOid =
          pilot.battlefield.find((card) => card.name === "Smuggler's Copter")?.oid ??
          (pilot.hand.some((card) => card.oid === copterOid)
            ? copterOid
            : (pilot.hand.find((card) => card.name === "Smuggler's Copter")?.oid ?? null));
        const copter = pilot.battlefield.find((card) => card.oid === copterOid);
        if (copter !== undefined && copterEnteredTurn === null) {
          copterEnteredTurn = session.view.turn.number;
        }
        const pilotCreature = pilot.battlefield.find((card) => card.name === 'Firedrinker Satyr');
        const opponentAttacker = opponent.battlefield.find((card) => card.name === 'Firedrinker Satyr');
        crewResolved ||=
          crewPaid &&
          copter !== undefined &&
          copter.typeLine.includes('Artifact') &&
          copter.typeLine.includes('Creature') &&
          copter.power === 3 &&
          copter.toughness === 3 &&
          crewCandidateOid !== null &&
          pilot.battlefield.find((card) => card.oid === crewCandidateOid)?.tapped === true &&
          session.view.stack.length === 0;
        discardObserved ||=
          discardOid !== null &&
          pilot.graveyard.some((card) => card.oid === discardOid) &&
          pilot.handSize === triggerHand;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.active}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        let staleSession: ObservedSession | null = null;
        let staleMove: string | null = null;

        if (decision.kind === 'mana-payment') {
          move =
            decision.options.find((option) => option.id.startsWith('mana-source-'))?.id ??
            decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'cost-crew-selection') {
          const exactCandidates = decision.options.filter((option) => option.id.startsWith('cost-crew-'));
          const legalOids = pilot.battlefield
            .filter(
              (card) =>
                card.oid !== copterOid &&
                card.typeLine.includes('Creature') &&
                !card.tapped &&
                card.power !== null,
            )
            .map((card) => card.oid)
            .sort();
          const offeredOids = exactCandidates
            .flatMap((option) => option.targets.map((target) => target.oid))
            .sort();
          expect(offeredOids).toEqual(crewCandidateChosen ? [] : legalOids);
          expect(decision.options.some((option) => option.id === 'cost-crew-cancel')).toBe(true);
          expect(decision.options.some((option) => option.id === 'cost-crew-finish')).toBe(
            crewCandidateChosen,
          );
          if (!crewInventedRejected) {
            await expect(session.submit('cost-crew-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            crewInventedRejected = true;
          }
          if (!crewCandidateChosen) {
            const candidate = exactCandidates.find((option) => option.targets[0]?.oid === pilotCreature?.oid);
            if (candidate === undefined) throw new Error('Forge offered no exact Crew 1 candidate');
            crewCandidateOid = candidate.targets[0]?.oid ?? null;
            crewCandidateChosen = true;
            staleSession = session;
            staleMove = candidate.id;
            move = candidate.id;
          } else if (crewAttempt === 'cancel') {
            move = decision.options.find((option) => option.id === 'cost-crew-cancel')?.id;
          } else {
            move = decision.options.find((option) => option.id === 'cost-crew-finish')?.id;
          }
        } else if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith("Smuggler's Copter:")) {
          triggerOffered = true;
          expect(decision.options.map((option) => option.id)).toEqual([
            'confirm-trigger-yes',
            'confirm-trigger-no',
          ]);
          expect(decision.options[0]?.targets).toEqual([
            expect.objectContaining({ oid: copterOid, name: "Smuggler's Copter" }),
          ]);
          triggerHand = pilot.handSize;
          triggerLibrary = pilot.librarySize;
          if (!triggerInventedRejected) {
            await expect(session.submit('confirm-trigger-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            triggerInventedRejected = true;
          }
          move = decision.options.find(
            (option) => option.id === (route === 'attack' ? 'confirm-trigger-no' : 'confirm-trigger-yes'),
          )?.id;
          if (move === undefined) throw new Error('Forge offered no exact trigger answer');
          triggerAccepted = route === 'block';
          staleSession = session;
          staleMove = move;
        } else if (decision.kind === 'hand-card-selection') {
          expect(triggerAccepted).toBe(true);
          drawBeforeDiscard ||=
            pilot.librarySize === triggerLibrary - 1 && pilot.handSize === triggerHand + 1;
          const offered = decision.options
            .flatMap((option) => option.targets.map((target) => target.oid))
            .sort();
          expect(offered).toEqual(pilot.hand.map((card) => card.oid).sort());
          if (!discardInventedRejected) {
            await expect(session.submit('discard-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            discardInventedRejected = true;
          }
          const discard = decision.options.find((option) => option.targets[0]?.name === 'Mountain');
          if (discard === undefined) throw new Error('Forge offered no exact Mountain discard');
          discardOid = discard.targets[0]?.oid ?? null;
          staleSession = session;
          staleMove = discard.id;
          move = discard.id;
        } else if (decision.kind === 'combat-attackers') {
          if (route === 'attack' && decision.seat === 0 && crewResolved && !attackerAdded) {
            const add = decision.options.find(
              (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === copterOid,
            );
            if (add === undefined) throw new Error('Forge did not offer the crewed Copter as an attacker');
            attackerAdded = true;
            move = add.id;
          } else if (
            route === 'block' &&
            decision.seat === 1 &&
            crewResolved &&
            opponentAttacker !== undefined &&
            !attackerAdded
          ) {
            const add = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === opponentAttacker.oid,
            );
            if (add === undefined) throw new Error('Forge did not offer the exact opposing attacker');
            attackerAdded = true;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          if (route === 'block' && decision.seat === 0 && attackerAdded && !blockerAdded) {
            const add = decision.options.find(
              (option) =>
                option.id.startsWith('combat-block-add-') &&
                option.targets[0]?.oid === copterOid &&
                option.targets[1]?.oid === opponentAttacker?.oid,
            );
            if (add === undefined) throw new Error('Forge did not offer the crewed Copter as exact blocker');
            blockerAdded = true;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          }
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'priority') {
          if (
            route === 'attack' &&
            triggerOffered &&
            !triggerAccepted &&
            triggerHand >= 0 &&
            triggerLibrary >= 0
          ) {
            declinedWithoutChange ||= pilot.handSize === triggerHand && pilot.librarySize === triggerLibrary;
          }
          const complete =
            route === 'attack'
              ? cancellationRolledBack && crewResolved && attackerAdded && declinedWithoutChange
              : crewResolved && attackerAdded && blockerAdded && drawBeforeDiscard && discardObserved;
          const playLand = decision.options.find((option) => option.text === 'Play Mountain');
          const pilotCreatureCast = decision.options.find((option) =>
            option.text.startsWith('Firedrinker Satyr:'),
          );
          const copterCast = decision.options.find(
            (option) => option.text.startsWith("Smuggler's Copter:") && !option.text.includes('Crew 1'),
          );
          const crew = decision.options.find(
            (option) => option.text.startsWith("Smuggler's Copter:") && option.text.includes('Crew 1'),
          );
          const crewWindow =
            route === 'attack'
              ? session.view.turn.active === 0 &&
                copterEnteredTurn !== null &&
                (!cancellationRolledBack || session.view.turn.number > copterEnteredTurn)
              : session.view.turn.active === 1;
          const readyForCrew =
            copter !== undefined &&
            pilotCreature !== undefined &&
            !pilotCreature.tapped &&
            !copter.typeLine.includes('Creature') &&
            !crewPaid &&
            crewWindow;
          const pilotMana = pilot.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const opponentMana = opponent.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          move =
            (complete ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            playLand?.id ??
            (decision.seat === 0 && pilotCreature === undefined && pilotMana >= 1
              ? pilotCreatureCast?.id
              : undefined) ??
            (decision.seat === 0 && copter === undefined && pilotMana >= 2 ? copterCast?.id : undefined) ??
            (decision.seat === 1 && route === 'block' && opponentAttacker === undefined && opponentMana >= 1
              ? pilotCreatureCast?.id
              : undefined) ??
            (decision.seat === 0 && readyForCrew ? crew?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === crew?.id) {
            crewAttempt = route === 'attack' && !cancellationRolledBack ? 'cancel' : 'pay';
            crewCandidateChosen = false;
            crewCandidateOid = null;
            if (crewAttempt === 'cancel') cancelBefore = publicPosition(session.view);
          }
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error("Forge offered no Smuggler's Copter move");
        const submittedFrom = session;
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;

        if (crewAttempt === 'cancel' && move === 'cost-crew-cancel') {
          expect(publicPosition(session.view)).toEqual(cancelBefore);
          cancellationRolledBack = true;
          crewAttempt = null;
          crewCandidateChosen = false;
          crewCandidateOid = null;
        } else if (crewAttempt === 'pay' && move === 'cost-crew-finish') {
          crewPaid = true;
          crewAttempt = null;
        }
        if (route === 'attack' && move === 'confirm-trigger-no') {
          declinedWithoutChange =
            session.view.seats[0].handSize === triggerHand &&
            session.view.seats[0].librarySize === triggerLibrary;
        }
        if (staleSession !== null && staleMove !== null) {
          expect(staleSession).toBe(submittedFrom);
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          if (staleMove.startsWith('cost-crew-')) crewStaleRejected = true;
          else if (staleMove.startsWith('confirm-trigger-')) triggerStaleRejected = true;
          else if (staleMove.startsWith('discard-card-')) discardStaleRejected = true;
        }
      }

      const evidence = `${trace.slice(-520).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(copterOid, evidence).toMatch(/^forge-card-/u);
      expect(cancellationRolledBack, evidence).toBe(route === 'attack');
      expect(crewInventedRejected, evidence).toBe(true);
      expect(crewStaleRejected, evidence).toBe(true);
      expect(crewPaid, evidence).toBe(true);
      expect(crewResolved, evidence).toBe(true);
      expect(attackerAdded, evidence).toBe(true);
      expect(blockerAdded, evidence).toBe(route === 'block');
      expect(triggerOffered, evidence).toBe(true);
      expect(triggerInventedRejected, evidence).toBe(true);
      expect(triggerStaleRejected, evidence).toBe(true);
      if (route === 'attack') {
        expect(declinedWithoutChange, evidence).toBe(true);
        expect(triggerAccepted, evidence).toBe(false);
      } else {
        expect(triggerAccepted, evidence).toBe(true);
        expect(drawBeforeDiscard, evidence).toBe(true);
        expect(discardOid, evidence).toMatch(/^forge-card-/u);
        expect(discardInventedRejected, evidence).toBe(true);
        expect(discardStaleRejected, evidence).toBe(true);
        expect(discardObserved, evidence).toBe(true);
      }
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
  360_000,
);
