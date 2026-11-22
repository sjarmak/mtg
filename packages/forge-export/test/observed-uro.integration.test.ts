/** Installed-Forge proof for Uro's exact ordinary and Escape routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type Decision = NonNullable<ObservedSession['decision']>;

function table(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Uro pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-uro-outcomes',
          cards: [
            { name: 'Mana Confluence', count: 30 },
            { name: 'Satyr Wayfinder', count: 20 },
            { name: "Uro, Titan of Nature's Wrath", count: 10 },
          ],
        },
      },
      {
        name: 'Passive opponent',
        controller: 'local',
        deck: { name: 'z5q4-uro-passive', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: 'z5q4-uro-installed-forge',
    maximumTurns: 30,
  };
}

function kroxaTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Kroxa pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-kroxa-escape-payment',
          cards: [
            { name: 'Mana Confluence', count: 30 },
            { name: 'Satyr Wayfinder', count: 20 },
            { name: "Kroxa, Titan of Death's Hunger", count: 10 },
          ],
        },
      },
      {
        name: 'Passive opponent',
        controller: 'local',
        deck: { name: 'z5q4-kroxa-passive', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: 'z5q4-kroxa-installed-forge',
    maximumTurns: 30,
  };
}

function routineMove(decision: Decision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  }
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

function sourceOidOfAbility(moveId: string): string {
  const match = /^ability-(\d+)-\d+$/.exec(moveId);
  if (match?.[1] === undefined) throw new Error(`Unexpected Forge ability move id: ${moveId}`);
  return `forge-card-${match[1]}`;
}

forgeIt(
  'sacrifices an ordinary Uro, escapes the exact graveyard object, and resolves its optional land and attack routes',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let wayfindersCast = 0;
    let ordinaryCast = false;
    let ordinaryOid: string | undefined;
    let ordinaryLifeBefore: number | undefined;
    let ordinaryLibraryBefore: number | undefined;
    let ordinaryGainResolved = false;
    let ordinaryResolved = false;
    let ordinaryLandDeclined = false;
    let enterTriggerOrdered = false;
    let inventedTriggerOrderRejected = false;
    let staleTriggerOrderRejected = false;
    let escapeCast = false;
    let escapeLifeBefore: number | undefined;
    let escapeLibraryBefore: number | undefined;
    let escapedResolved = false;
    let escapedLandPlaced: string | undefined;
    const escapedCostCards: string[] = [];
    let inventedCostRejected = false;
    let staleCostRejected = false;
    let attackDeclared = false;
    let attackTriggerAccepted = false;
    let attackLifeBefore: number | undefined;
    let attackLibraryBefore: number | undefined;
    let attackResolved = false;

    try {
      const spec = table();
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Uro decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (pilot.hand === null || opponent.hand === null) throw new Error('Forge hid a Uro probe hand');
        const battlefieldUro = pilot.battlefield.find((card) => card.name === "Uro, Titan of Nature's Wrath");
        const stackedUro = session.view.stack.some((card) => card.name === "Uro, Titan of Nature's Wrath");

        if (decision.kind === 'priority' && stackedUro) {
          if (escapeCast && escapeLifeBefore === undefined) escapeLifeBefore = pilot.life;
          else if (ordinaryCast && ordinaryLifeBefore === undefined) ordinaryLifeBefore = pilot.life;
        }

        if (
          ordinaryCast &&
          !escapeCast &&
          ordinaryGainResolved &&
          ordinaryOid !== undefined &&
          pilot.graveyard.some((card) => card.oid === ordinaryOid) &&
          !session.view.stack.some((card) => card.name === "Uro, Titan of Nature's Wrath")
        ) {
          ordinaryResolved = true;
        }
        if (
          escapeCast &&
          ordinaryOid !== undefined &&
          battlefieldUro?.oid === ordinaryOid &&
          escapedCostCards.every((oid) => pilot.exile.some((card) => card.oid === oid)) &&
          !session.view.stack.some((card) => card.name === "Uro, Titan of Nature's Wrath")
        ) {
          if (escapedLandPlaced !== undefined) {
            expect(pilot.battlefield.some((card) => card.oid === escapedLandPlaced)).toBe(true);
            escapedResolved = true;
          }
        }

        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = routineMove(decision);
        let staleMove: string | null = null;
        let staleWasTriggerOrder = false;
        const staleSession = session;

        if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'entity-selection') {
          move = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Mana Confluence',
          )?.id;
        } else if (decision.kind === 'zone-card-selection') {
          expect(decision.seat).toBe(0);
          const landChoices = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Mana Confluence',
          );
          if (!ordinaryLandDeclined) {
            expect(pilot.life).toBe((ordinaryLifeBefore ?? 0) + 3);
            expect(pilot.librarySize).toBe((ordinaryLibraryBefore ?? 0) - 1);
            ordinaryGainResolved = true;
            ordinaryLandDeclined = true;
            move = decision.options.find((option) => option.id === 'zone-decline')?.id;
          } else if (escapedLandPlaced === undefined) {
            expect(pilot.life).toBe((escapeLifeBefore ?? 0) + 3);
            expect(pilot.librarySize).toBe((escapeLibraryBefore ?? 0) - 1);
            expect(landChoices.length).toBeGreaterThan(0);
            escapedLandPlaced = landChoices[0]?.targets[0]?.oid;
            move = landChoices[0]?.id;
          } else if (attackTriggerAccepted && !attackResolved) {
            expect(pilot.life).toBe((attackLifeBefore ?? 0) + 3);
            expect(pilot.librarySize).toBe((attackLibraryBefore ?? 0) - 1);
            attackResolved = true;
            move = decision.options.find((option) => option.id === 'zone-decline')?.id;
          } else {
            move = decision.options.find((option) => option.id === 'zone-decline')?.id;
          }
        } else if (decision.kind === 'trigger-order') {
          expect(decision.seat).toBe(0);
          expect(decision.options).toHaveLength(2);
          expect(new Set(decision.options.map((option) => option.id)).size).toBe(2);
          expect(
            decision.options.every(
              (option) =>
                option.targets.length === 1 &&
                option.targets[0]?.oid === ordinaryOid &&
                option.targets[0]?.name === "Uro, Titan of Nature's Wrath",
            ),
          ).toBe(true);
          expect(
            decision.options.some((option) => option.text.includes('sacrifice-unless-escaped trigger next')),
          ).toBe(true);
          const gainFirst = decision.options.find((option) =>
            option.text.includes('gain 3 life, draw a card, and optional land trigger next'),
          );
          expect(gainFirst).toBeDefined();
          if (!inventedTriggerOrderRejected) {
            await expect(session.submit('trigger-order-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedTriggerOrderRejected = true;
          }
          enterTriggerOrdered = true;
          move = gainFirst?.id;
          staleMove = move ?? null;
          staleWasTriggerOrder = true;
        } else if (decision.kind === 'cost-card-selection') {
          expect(decision.seat).toBe(0);
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length).toBeGreaterThanOrEqual(5 - escapedCostCards.length);
          expect(
            candidates.every(
              (option) =>
                option.targets[0]?.oid !== ordinaryOid &&
                pilot.graveyard.some((card) => card.oid === option.targets[0]?.oid),
            ),
          ).toBe(true);
          if (!inventedCostRejected) {
            await expect(session.submit('cost-card-selection-forge-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedCostRejected = true;
          }
          const selected = candidates.find(
            (option) => !escapedCostCards.includes(option.targets[0]?.oid ?? ''),
          );
          const oid = selected?.targets[0]?.oid;
          if (selected === undefined || oid === undefined) throw new Error('Missing exact Escape cost card');
          escapedCostCards.push(oid);
          move = selected.id;
          if (!staleCostRejected) staleMove = move;
        } else if (decision.kind === 'confirm-action' && decision.prompt.includes('Cancel Search?')) {
          expect(ordinaryLandDeclined).toBe(true);
          move = decision.options.find((option) => option.id === 'confirm-action-yes')?.id;
        } else if (
          decision.kind === 'confirm-trigger' &&
          decision.prompt.startsWith("Uro, Titan of Nature's Wrath:")
        ) {
          attackTriggerAccepted = true;
          attackLifeBefore = pilot.life;
          attackLibraryBefore = pilot.librarySize;
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
        } else if (decision.kind === 'combat-attackers' && escapedResolved && !attackDeclared) {
          const attack = decision.options.find((option) =>
            option.targets.some((target) => target.oid === ordinaryOid),
          );
          if (attack !== undefined) {
            attackDeclared = true;
            move = attack.id;
          }
        } else if (decision.kind === 'priority') {
          if (attackResolved) {
            move = decision.options.find((option) => option.text === 'Concede')?.id;
          } else if (decision.seat === 0) {
            const lands = pilot.battlefield.filter((card) => card.name === 'Mana Confluence');
            if (lands.length < 4) {
              move = decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ?? move;
            }
            const untappedLands = pilot.battlefield.filter(
              (card) => card.name === 'Mana Confluence' && !card.tapped,
            ).length;
            const nonUroGraveyard = pilot.graveyard.filter(
              (card) => card.name !== "Uro, Titan of Nature's Wrath",
            );
            const wayfinder = decision.options.find((option) => option.text.startsWith('Satyr Wayfinder:'));
            if (
              !ordinaryCast &&
              nonUroGraveyard.length < 5 &&
              wayfinder !== undefined &&
              untappedLands >= 2
            ) {
              wayfindersCast += 1;
              move = wayfinder.id;
            } else if (!ordinaryCast && nonUroGraveyard.length >= 5 && untappedLands >= 3) {
              const cast = decision.options.find(
                (option) =>
                  option.text.startsWith("Uro, Titan of Nature's Wrath:") && !option.text.includes('Escape—'),
              );
              if (cast !== undefined) {
                const handUro = sourceOidOfAbility(cast.id);
                expect(pilot.hand.some((card) => card.oid === handUro)).toBe(true);
                ordinaryCast = true;
                ordinaryOid = handUro;
                ordinaryLibraryBefore = pilot.librarySize;
                move = cast.id;
              }
            } else if (ordinaryResolved && !escapeCast && untappedLands >= 4) {
              const cast = decision.options.find(
                (option) =>
                  option.text.startsWith("Uro, Titan of Nature's Wrath:") &&
                  option.text.includes('Escape—') &&
                  sourceOidOfAbility(option.id) === ordinaryOid,
              );
              if (cast !== undefined) {
                escapeCast = true;
                escapeLibraryBefore = pilot.librarySize;
                move = cast.id;
              }
            }
          } else {
            move = decision.options.find((option) => option.text === 'Play Mountain')?.id ?? move;
          }
        }

        if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleMove !== null) {
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          if (staleWasTriggerOrder) staleTriggerOrderRejected = true;
          else staleCostRejected = true;
        }
      }

      expect(wayfindersCast).toBeGreaterThanOrEqual(2);
      expect(ordinaryResolved).toBe(true);
      expect(ordinaryLandDeclined).toBe(true);
      expect(enterTriggerOrdered).toBe(true);
      expect(inventedTriggerOrderRejected).toBe(true);
      expect(staleTriggerOrderRejected).toBe(true);
      expect(escapeCast).toBe(true);
      expect(escapedCostCards).toHaveLength(5);
      expect(new Set(escapedCostCards).size).toBe(5);
      expect(inventedCostRejected).toBe(true);
      expect(staleCostRejected).toBe(true);
      expect(escapedResolved).toBe(true);
      expect(attackDeclared).toBe(true);
      expect(attackTriggerAccepted).toBe(true);
      expect(attackResolved).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-180).join('\n')}`, { cause });
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

forgeIt(
  "pays Kroxa's exact Escape cost with five distinct other graveyard cards",
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let wayfindersCast = 0;
    let ordinaryCast = false;
    let ordinaryOid: string | undefined;
    let ordinaryResolved = false;
    let escapeCast = false;
    let escapedResolved = false;
    const escapedCostCards: string[] = [];
    let ordinaryDiscardOid: string | undefined;
    let escapedDiscardOid: string | undefined;
    let ordinaryOpponentLifeBefore: number | undefined;
    let escapedOpponentLifeBefore: number | undefined;
    let inventedCostRejected = false;
    let staleCostRejected = false;

    try {
      const spec = kroxaTable();
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Kroxa decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (pilot.hand === null) throw new Error('Forge hid the Kroxa probe hand');
        if (opponent.hand === null) throw new Error('Forge hid the Kroxa opponent hand');
        const stackedKroxa = session.view.stack.some(
          (card) => card.name === "Kroxa, Titan of Death's Hunger",
        );
        const battlefieldKroxa = pilot.battlefield.find(
          (card) => card.name === "Kroxa, Titan of Death's Hunger",
        );

        if (
          ordinaryCast &&
          !escapeCast &&
          ordinaryOid !== undefined &&
          ordinaryDiscardOid !== undefined &&
          pilot.graveyard.some((card) => card.oid === ordinaryOid) &&
          opponent.graveyard.some((card) => card.oid === ordinaryDiscardOid) &&
          ordinaryOpponentLifeBefore !== undefined &&
          opponent.life === ordinaryOpponentLifeBefore - 3 &&
          !stackedKroxa &&
          session.view.stack.length === 0
        ) {
          ordinaryResolved = true;
        }
        if (
          escapeCast &&
          ordinaryOid !== undefined &&
          battlefieldKroxa?.oid === ordinaryOid &&
          escapedDiscardOid !== undefined &&
          opponent.graveyard.some((card) => card.oid === escapedDiscardOid) &&
          escapedOpponentLifeBefore !== undefined &&
          opponent.life === escapedOpponentLifeBefore - 3 &&
          escapedCostCards.length === 5 &&
          escapedCostCards.every((oid) => pilot.exile.some((card) => card.oid === oid)) &&
          session.view.stack.length === 0
        ) {
          escapedResolved = true;
        }

        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = routineMove(decision);
        let staleMove: string | null = null;
        const staleSession = session;

        if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'hand-card-selection') {
          expect(decision.seat).toBe(1);
          const selected = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Mountain',
          );
          const discardedOid = selected?.targets[0]?.oid;
          if (selected === undefined || discardedOid === undefined) {
            throw new Error('Missing exact Kroxa opponent discard card');
          }
          if (escapeCast) {
            escapedDiscardOid = discardedOid;
            escapedOpponentLifeBefore = opponent.life;
          } else {
            ordinaryDiscardOid = discardedOid;
            ordinaryOpponentLifeBefore = opponent.life;
          }
          move = selected.id;
        } else if (decision.kind === 'entity-selection') {
          move = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Mana Confluence',
          )?.id;
        } else if (decision.kind === 'trigger-order') {
          expect(decision.seat).toBe(0);
          expect(decision.options).toHaveLength(2);
          expect(
            decision.options.every(
              (option) =>
                option.targets.length === 1 &&
                option.targets[0]?.oid === ordinaryOid &&
                option.targets[0]?.name === "Kroxa, Titan of Death's Hunger",
            ),
          ).toBe(true);
          move = decision.options[0]?.id;
        } else if (decision.kind === 'cost-card-selection') {
          expect(decision.seat).toBe(0);
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length).toBeGreaterThanOrEqual(5 - escapedCostCards.length);
          expect(
            candidates.every(
              (option) =>
                option.targets[0]?.oid !== ordinaryOid &&
                pilot.graveyard.some((card) => card.oid === option.targets[0]?.oid),
            ),
          ).toBe(true);
          if (!inventedCostRejected) {
            await expect(session.submit('cost-card-selection-forge-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedCostRejected = true;
          }
          const selected = candidates.find(
            (option) => !escapedCostCards.includes(option.targets[0]?.oid ?? ''),
          );
          const oid = selected?.targets[0]?.oid;
          if (selected === undefined || oid === undefined) throw new Error('Missing exact Kroxa Escape card');
          escapedCostCards.push(oid);
          move = selected.id;
          if (!staleCostRejected) staleMove = move;
        } else if (decision.kind === 'priority') {
          if (escapedResolved) {
            move = decision.options.find((option) => option.text === 'Concede')?.id;
          } else if (decision.seat === 0) {
            const lands = pilot.battlefield.filter((card) => card.name === 'Mana Confluence');
            if (lands.length < 4) {
              move = decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ?? move;
            }
            const untappedLands = pilot.battlefield.filter(
              (card) => card.name === 'Mana Confluence' && !card.tapped,
            ).length;
            const nonKroxaGraveyard = pilot.graveyard.filter(
              (card) => card.name !== "Kroxa, Titan of Death's Hunger",
            );
            const wayfinder = decision.options.find((option) => option.text.startsWith('Satyr Wayfinder:'));
            if (
              !ordinaryCast &&
              nonKroxaGraveyard.length < 5 &&
              wayfinder !== undefined &&
              untappedLands >= 2
            ) {
              wayfindersCast += 1;
              move = wayfinder.id;
            } else if (!ordinaryCast && nonKroxaGraveyard.length >= 5 && untappedLands >= 2) {
              const cast = decision.options.find(
                (option) =>
                  option.text.startsWith("Kroxa, Titan of Death's Hunger:") &&
                  !option.text.includes('Escape—'),
              );
              if (cast !== undefined) {
                const handKroxa = sourceOidOfAbility(cast.id);
                expect(pilot.hand.some((card) => card.oid === handKroxa)).toBe(true);
                ordinaryCast = true;
                ordinaryOid = handKroxa;
                move = cast.id;
              }
            } else if (ordinaryResolved && !escapeCast && untappedLands >= 4) {
              const cast = decision.options.find(
                (option) =>
                  option.text.startsWith("Kroxa, Titan of Death's Hunger:") &&
                  option.text.includes('Escape—') &&
                  sourceOidOfAbility(option.id) === ordinaryOid,
              );
              if (cast !== undefined) {
                escapeCast = true;
                move = cast.id;
              }
            }
          } else {
            move = decision.options.find((option) => option.text === 'Play Mountain')?.id ?? move;
          }
        }

        if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleMove !== null) {
          await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleCostRejected = true;
        }
      }

      expect(wayfindersCast).toBeGreaterThanOrEqual(2);
      expect(ordinaryResolved).toBe(true);
      expect(ordinaryDiscardOid).toBeDefined();
      expect(escapeCast).toBe(true);
      expect(escapedCostCards).toHaveLength(5);
      expect(new Set(escapedCostCards).size).toBe(5);
      expect(inventedCostRejected).toBe(true);
      expect(staleCostRejected).toBe(true);
      expect(escapedResolved).toBe(true);
      expect(escapedDiscardOid).toBeDefined();
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-180).join('\n')}`, { cause });
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
