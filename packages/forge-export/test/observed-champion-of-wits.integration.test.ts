/** Installed-Forge proof for Champion of Wits' exact entry and Eternalize routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, PendingDecision, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const table: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Champion pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-champion-of-wits',
        cards: [
          { name: 'Island', count: 30 },
          { name: 'Champion of Wits', count: 30 },
        ],
      },
    },
    {
      name: 'Champion observer',
      controller: 'local',
      deck: { name: 'z5q4-champion-observer', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-reviewed-champion-of-wits-outcomes',
  maximumTurns: 40,
};

function abilityMoveFrom(oid: string): string {
  return `ability-${oid.replace(/^forge-card-/u, '')}-`;
}

function routineMove(decision: PendingDecision): string | undefined {
  return decision.options.find((option) => option.text === 'Play first' || option.text === 'Keep this hand')
    ?.id;
}

forgeIt(
  'proves the declined, ordinary draw-two, and Eternalized draw-four outcomes',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(table)).toEqual([]);
    const opened = await backend.open(table);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    const trace: string[] = [];
    let ordinaryCasts = 0;
    let acceptedTrigger: 'ordinary' | 'eternalized' | null = null;
    let declinedHand = -1;
    let declinedLibrary = -1;
    let declineUnchanged = false;
    let ordinaryHand = -1;
    let ordinaryLibrary = -1;
    let ordinaryDrawObserved = false;
    let ordinaryResolved = false;
    let eternalizedHand = -1;
    let eternalizedLibrary = -1;
    let eternalizedDrawObserved = false;
    let eternalizedResolved = false;
    const ordinaryDiscardOids: string[] = [];
    const eternalizedDiscardOids: string[] = [];
    let eternalizeSourceOid: string | null = null;
    let eternalizeTokenOid: string | null = null;
    let eternalizeSubmitted = false;
    let eternalizeSourceExiled = false;
    let eternalizeTokenExact = false;
    let sorceryAbsenceObserved = false;
    let manaPayments = 0;
    const manaSources = new Set<string>();
    const inventedTriggerRoutes = new Set<string>();
    const staleTriggerRoutes = new Set<string>();
    const inventedDiscardRoutes = new Set<string>();
    const staleDiscardRoutes = new Set<string>();
    let inventedEternalizeRejected = false;
    let staleEternalizeRejected = false;
    let inventedSourceExileRejected = false;
    let staleSourceExileRejected = false;
    let sourceExileConfirmed = false;

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Champion decision');
        const pilot = session.view.seats[0];
        if (pilot.hand === null) throw new Error('Forge hid the local hand');
        eternalizeSourceExiled ||=
          eternalizeSourceOid !== null &&
          pilot.exile.some((card) => card.oid === eternalizeSourceOid) &&
          !pilot.graveyard.some((card) => card.oid === eternalizeSourceOid);
        const eternalizedToken = pilot.battlefield.find(
          (card) =>
            card.name === 'Champion of Wits' &&
            card.oid !== eternalizeSourceOid &&
            card.power === 4 &&
            card.toughness === 4 &&
            card.typeLine.includes('Zombie') &&
            card.typeLine.includes('Snake') &&
            card.typeLine.includes('Wizard'),
        );
        if (eternalizedToken !== undefined) {
          eternalizeTokenOid ??= eternalizedToken.oid;
          eternalizeTokenExact = true;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} active=${String(session.view.turn.active)} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = routineMove(decision);
        let staleSession: ObservedSession | null = null;
        let staleMove: string | null = null;
        let staleRoute: string | null = null;
        let completedDiscardRoute: 'ordinary' | 'eternalized' | null = null;

        if (decision.kind === 'mana-payment') {
          const source = decision.options.find((option) => option.id.startsWith('mana-source-'));
          move = source?.id ?? decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          if (eternalizeSubmitted && !eternalizeTokenExact && source !== undefined && move === source.id) {
            const oid = source.targets[0]?.oid;
            if (oid === undefined) throw new Error('Forge exposed mana without a source object');
            manaPayments += 1;
            manaSources.add(oid);
          }
        } else if (decision.kind === 'cost-exile-confirm') {
          expect(eternalizeSubmitted).toBe(true);
          expect(decision.options.map((option) => option.id)).toEqual([
            'cost-exile-confirm-yes',
            'cost-exile-confirm-no',
          ]);
          expect(decision.options[0]?.targets).toEqual([
            expect.objectContaining({ oid: eternalizeSourceOid, name: 'Champion of Wits' }),
          ]);
          await expect(session.submit('cost-exile-confirm-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedSourceExileRejected = true;
          move = 'cost-exile-confirm-yes';
          sourceExileConfirmed = true;
          staleSession = session;
          staleMove = move;
          staleRoute = 'source-exile';
        } else if (decision.kind === 'confirm-trigger') {
          const route = ordinaryCasts === 1 ? 'decline' : eternalizeSubmitted ? 'eternalized' : 'ordinary';
          expect(decision.prompt).toContain('Champion of Wits: Use this triggered ability?');
          expect(decision.options.map((option) => option.id)).toEqual([
            'confirm-trigger-yes',
            'confirm-trigger-no',
          ]);
          if (!inventedTriggerRoutes.has(route)) {
            await expect(session.submit('confirm-trigger-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedTriggerRoutes.add(route);
          }
          if (route === 'decline') {
            declinedHand = pilot.handSize;
            declinedLibrary = pilot.librarySize;
            move = 'confirm-trigger-no';
          } else {
            if (route === 'ordinary') {
              ordinaryHand = pilot.handSize;
              ordinaryLibrary = pilot.librarySize;
            } else {
              eternalizedHand = pilot.handSize;
              eternalizedLibrary = pilot.librarySize;
              expect(decision.options[0]?.targets).toEqual([
                expect.objectContaining({ oid: eternalizeTokenOid, name: 'Champion of Wits' }),
              ]);
            }
            acceptedTrigger = route;
            move = 'confirm-trigger-yes';
          }
          staleSession = session;
          staleMove = move;
          staleRoute = `trigger:${route}`;
        } else if (decision.kind === 'hand-card-selection') {
          const route = acceptedTrigger;
          if (route === null) throw new Error('Forge requested a discard without an accepted trigger');
          const selected = route === 'ordinary' ? ordinaryDiscardOids : eternalizedDiscardOids;
          const beforeHand = route === 'ordinary' ? ordinaryHand : eternalizedHand;
          const beforeLibrary = route === 'ordinary' ? ordinaryLibrary : eternalizedLibrary;
          const drawCount = route === 'ordinary' ? 2 : 4;
          expect(pilot.librarySize).toBe(beforeLibrary - drawCount);
          expect(pilot.handSize).toBe(beforeHand + drawCount);
          if (route === 'ordinary') ordinaryDrawObserved = true;
          else eternalizedDrawObserved = true;

          const candidates = decision.options.filter((option) => option.targets.length === 1);
          const offeredOids = candidates.map((option) => option.targets[0]!.oid).sort();
          const expectedOids = pilot.hand
            .map((card) => card.oid)
            .filter((oid) => !selected.includes(oid))
            .sort();
          expect(offeredOids).toEqual(expectedOids);
          if (!inventedDiscardRoutes.has(route)) {
            await expect(session.submit('hand-card-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedDiscardRoutes.add(route);
          }
          const selectedOption =
            (route === 'ordinary' && selected.length === 0
              ? candidates.find((option) => option.targets[0]?.name === 'Champion of Wits')
              : undefined) ??
            candidates.find((option) => option.targets[0]?.name === 'Island') ??
            candidates[0];
          if (selectedOption === undefined) throw new Error('Forge offered no live discard candidate');
          const selectedOid = selectedOption.targets[0]!.oid;
          selected.push(selectedOid);
          if (route === 'ordinary' && selected.length === 1) eternalizeSourceOid = selectedOid;
          move = selectedOption.id;
          staleSession = session;
          staleMove = move;
          staleRoute = `discard:${route}`;
          if (selected.length === 2) completedDiscardRoute = route;
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options.find((option) => option.targets[0]?.name === 'Island')?.id ??
            decision.options[0]?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const untappedIslands = pilot.battlefield.filter(
            (card) => card.name === 'Island' && !card.tapped,
          ).length;
          const castChampion = decision.options.find((option) => option.text.startsWith('Champion of Wits:'));
          const eternalize =
            eternalizeSourceOid === null
              ? undefined
              : decision.options.find(
                  (option) =>
                    option.id.startsWith(abilityMoveFrom(eternalizeSourceOid!)) &&
                    option.text.startsWith('Champion of Wits:') &&
                    option.text.includes('Eternalize'),
                );
          const atSorcerySpeed =
            decision.seat === 0 &&
            session.view.turn.active === 0 &&
            ['MAIN1', 'MAIN2'].includes(session.view.turn.step) &&
            session.view.stack.length === 0;
          if (ordinaryResolved && !eternalizeSubmitted && !atSorcerySpeed) {
            expect(eternalize).toBeUndefined();
            sorceryAbsenceObserved = true;
          }
          move =
            (eternalizedResolved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Island')?.id
              : undefined) ??
            (decision.seat === 0 && ordinaryCasts < 2 && untappedIslands >= 3
              ? castChampion?.id
              : undefined) ??
            (ordinaryResolved &&
            sorceryAbsenceObserved &&
            !eternalizeSubmitted &&
            atSorcerySpeed &&
            untappedIslands >= 7
              ? eternalize?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castChampion !== undefined && move === castChampion.id && ordinaryCasts < 2) {
            ordinaryCasts += 1;
          }
          if (eternalize !== undefined && move === eternalize.id) {
            await expect(session.submit('priority-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedEternalizeRejected = true;
            eternalizeSubmitted = true;
            staleSession = session;
            staleMove = move;
            staleRoute = 'eternalize';
          }
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Champion move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-200).join('\n')}`);
        session = advanced.session;

        if (declinedHand >= 0 && !declineUnchanged && move === 'confirm-trigger-no') {
          expect(session.view.seats[0].handSize).toBe(declinedHand);
          expect(session.view.seats[0].librarySize).toBe(declinedLibrary);
          declineUnchanged = true;
        }
        if (completedDiscardRoute !== null) {
          const after = session.view.seats[0];
          const selected =
            completedDiscardRoute === 'ordinary' ? ordinaryDiscardOids : eternalizedDiscardOids;
          expect(selected).toHaveLength(2);
          expect(selected.every((oid) => after.graveyard.some((card) => card.oid === oid))).toBe(true);
          if (completedDiscardRoute === 'ordinary') {
            expect(after.handSize).toBe(ordinaryHand);
            ordinaryResolved = true;
          } else {
            expect(after.handSize).toBe(eternalizedHand + 2);
            eternalizedResolved = true;
          }
          acceptedTrigger = null;
        }
        if (staleSession !== null && staleMove !== null && staleRoute !== null) {
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          if (staleRoute.startsWith('trigger:')) staleTriggerRoutes.add(staleRoute.slice(8));
          else if (staleRoute.startsWith('discard:')) staleDiscardRoutes.add(staleRoute.slice(8));
          else if (staleRoute === 'source-exile') staleSourceExileRejected = true;
          else staleEternalizeRejected = true;
        }
      }

      const evidence = `${trace.slice(-700).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(ordinaryCasts, evidence).toBe(2);
      expect(declineUnchanged, evidence).toBe(true);
      expect(ordinaryDrawObserved, evidence).toBe(true);
      expect(ordinaryDiscardOids, evidence).toHaveLength(2);
      expect(ordinaryResolved, evidence).toBe(true);
      expect(eternalizeSourceOid, evidence).toMatch(/^forge-card-/u);
      expect(sorceryAbsenceObserved, evidence).toBe(true);
      expect(inventedEternalizeRejected, evidence).toBe(true);
      expect(staleEternalizeRejected, evidence).toBe(true);
      expect(inventedSourceExileRejected, evidence).toBe(true);
      expect(staleSourceExileRejected, evidence).toBe(true);
      expect(sourceExileConfirmed, evidence).toBe(true);
      expect(manaPayments, evidence).toBe(7);
      expect(manaSources.size, evidence).toBe(7);
      expect(eternalizeSourceExiled, evidence).toBe(true);
      expect(eternalizeTokenOid, evidence).toMatch(/^forge-card-/u);
      expect(eternalizeTokenExact, evidence).toBe(true);
      expect(eternalizedDrawObserved, evidence).toBe(true);
      expect(eternalizedDiscardOids, evidence).toHaveLength(2);
      expect(eternalizedResolved, evidence).toBe(true);
      expect(inventedTriggerRoutes, evidence).toEqual(new Set(['decline', 'ordinary', 'eternalized']));
      expect(staleTriggerRoutes, evidence).toEqual(new Set(['decline', 'ordinary', 'eternalized']));
      expect(inventedDiscardRoutes, evidence).toEqual(new Set(['ordinary', 'eternalized']));
      expect(staleDiscardRoutes, evidence).toEqual(new Set(['ordinary', 'eternalized']));
      expect(session.status, evidence).toBe('finished');
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-700).join('\n')}`, { cause });
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);
