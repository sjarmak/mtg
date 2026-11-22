/** Installed-Forge board proof for Huntmaster's exact two-face composition. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

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

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Huntmaster pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-huntmaster-installed-forge',
        cards: [
          { name: 'Taiga', count: 30 },
          { name: 'Llanowar Elves', count: 15 },
          { name: 'Huntmaster of the Fells', count: 15 },
        ],
      },
    },
    {
      name: 'Huntmaster target',
      controller: 'local',
      deck: {
        name: 'z5q4-huntmaster-target',
        cards: [
          { name: 'Plains', count: 45 },
          { name: 'Mother of Runes', count: 15 },
        ],
      },
    },
  ],
  seed: 'z5q4-huntmaster-exact-transform-and-damage',
  maximumTurns: 30,
};

forgeIt(
  'creates the pinned Wolf, transforms both ways, and enforces dependent Ravager targets',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(TABLE)).toEqual([]);
    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    const trace: string[] = [];
    let huntmasterCast = false;
    let huntmasterOid: string | undefined;
    let motherOid: string | undefined;
    let frontEntryObserved = false;
    let firstRavagerObserved = false;
    let returnedFrontObserved = false;
    let secondRavagerObserved = false;
    let rootTargets = 0;
    let selectedCreature = false;
    let choseNoCreature = false;
    let firstDamageObserved = false;
    let secondDamageObserved = false;
    let inventedRejected = false;
    let inventedPreserved = false;
    let staleRejected = false;
    let elvesCast = 0;

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Huntmaster decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const front = local.battlefield.find((card) => card.name === 'Huntmaster of the Fells');
        const back = local.battlefield.find((card) => card.name === 'Ravager of the Fells');
        huntmasterOid ??= front?.oid ?? back?.oid;
        motherOid ??= opponent.battlefield.find((card) => card.name === 'Mother of Runes')?.oid;
        const wolves = local.battlefield.filter(
          (card) => card.name.includes('Wolf') && card.oid !== huntmasterOid,
        );
        frontEntryObserved ||=
          huntmasterCast && front?.oid === huntmasterOid && wolves.length === 1 && local.life === 22;
        firstRavagerObserved ||=
          back !== undefined && back.oid === huntmasterOid && back.power === 4 && back.toughness === 4;
        returnedFrontObserved ||=
          firstRavagerObserved && front?.oid === huntmasterOid && wolves.length === 2 && local.life === 24;
        secondRavagerObserved ||=
          returnedFrontObserved &&
          back !== undefined &&
          back.oid === huntmasterOid &&
          back.power === 4 &&
          back.toughness === 4;
        firstDamageObserved ||=
          selectedCreature &&
          motherOid !== undefined &&
          opponent.life === 18 &&
          opponent.graveyard.some((card) => card.oid === motherOid) &&
          session.view.stack.length === 0;
        secondDamageObserved ||= choseNoCreature && opponent.life === 16 && session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} life=${String(local.life)}/${String(opponent.life)} face=${front === undefined ? (back?.name ?? '-') : front.name} wolves=${String(wolves.length)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (
          decision.kind === 'target-selection' &&
          decision.seat === 0 &&
          decision.prompt === 'Select target player or planeswalker'
        ) {
          rootTargets += 1;
          expect(
            decision.options.map((option) => option.id),
            trace.at(-1),
          ).toEqual(['target-player-1']);
          expect(
            decision.options.some((option) => option.id === 'target-cancel'),
            trace.at(-1),
          ).toBe(false);
          if (!inventedRejected) {
            const viewBefore = JSON.stringify(session.view);
            const decisionBefore = JSON.stringify(session.decision);
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
            inventedPreserved =
              JSON.stringify(session.view) === viewBefore &&
              JSON.stringify(session.decision) === decisionBefore;
          }
          const stale = session;
          const advanced = await session.submit('target-player-1');
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          if (!staleRejected) {
            await expect(stale.submit('target-player-1')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
          }
          continue;
        }
        if (
          decision.kind === 'target-selection' &&
          decision.seat === 0 &&
          decision.prompt ===
            "Select up to one target creature that player or that planeswalker's controller controls"
        ) {
          const creatureTargets = decision.options.filter((option) => option.targets.length === 1);
          expect(
            decision.options.some((option) => option.id === 'target-none'),
            trace.at(-1),
          ).toBe(true);
          expect(
            decision.options.some((option) => option.id === 'target-cancel'),
            trace.at(-1),
          ).toBe(false);
          expect(
            creatureTargets.every((option) =>
              opponent.battlefield.some(
                (card) =>
                  card.oid === option.targets[0]?.oid &&
                  card.typeLine.includes('Creature') &&
                  card.controller === 1,
              ),
            ),
            trace.at(-1),
          ).toBe(true);
          if (rootTargets === 1) {
            const mother = creatureTargets.find((option) => option.targets[0]?.oid === motherOid);
            if (mother === undefined)
              throw new Error('Huntmaster omitted the dependent Mother of Runes target');
            move = mother.id;
            selectedCreature = true;
          } else {
            move = 'target-none';
            choseNoCreature = true;
          }
        } else if (decision.kind === 'priority') {
          const taigas = local.battlefield.filter((card) => card.name === 'Taiga').length;
          const plains = opponent.battlefield.filter((card) => card.name === 'Plains').length;
          const huntmaster = decision.options.find((option) =>
            option.text.startsWith('Huntmaster of the Fells:'),
          );
          const elf = decision.options.find((option) => option.text.startsWith('Llanowar Elves:'));
          const mother = decision.options.find((option) => option.text.startsWith('Mother of Runes:'));
          move =
            (secondDamageObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Taiga')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 1 && motherOid === undefined && plains >= 1 ? mother?.id : undefined) ??
            (decision.seat === 0 && !huntmasterCast && taigas >= 4 ? huntmaster?.id : undefined) ??
            (decision.seat === 0 && firstDamageObserved && elvesCast < 2 ? elf?.id : undefined) ??
            routineMove(decision);
          huntmasterCast ||= move !== undefined && move === huntmaster?.id;
          if (move !== undefined && move === elf?.id) elvesCast += 1;
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Huntmaster move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(huntmasterCast, evidence).toBe(true);
      expect(huntmasterOid, evidence).toMatch(/^forge-card-/u);
      expect(motherOid, evidence).toMatch(/^forge-card-/u);
      expect(frontEntryObserved, evidence).toBe(true);
      expect(firstRavagerObserved, evidence).toBe(true);
      expect(firstDamageObserved, evidence).toBe(true);
      expect(elvesCast, evidence).toBe(2);
      expect(returnedFrontObserved, evidence).toBe(true);
      expect(secondRavagerObserved, evidence).toBe(true);
      expect(rootTargets, evidence).toBeGreaterThanOrEqual(2);
      expect(selectedCreature, evidence).toBe(true);
      expect(choseNoCreature, evidence).toBe(true);
      expect(secondDamageObserved, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(inventedPreserved, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  420_000,
);
