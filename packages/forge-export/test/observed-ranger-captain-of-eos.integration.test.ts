/** Installed-Forge proof for Ranger-Captain of Eos's optional search and turn lock. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function spec(seed: string, withSearchTarget: boolean): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Ranger pilot',
        controller: 'local',
        deck: {
          name: seed,
          cards: [
            { name: 'Plains', count: withSearchTarget ? 30 : 36 },
            { name: 'Ranger-Captain of Eos', count: withSearchTarget ? 15 : 24 },
            ...(withSearchTarget ? [{ name: 'Mother of Runes', count: 15 }] : []),
          ],
        },
      },
      {
        name: 'Spell pilot',
        controller: 'local',
        deck: {
          name: `${seed}-opponent`,
          cards: withSearchTarget
            ? [{ name: 'Mountain', count: 60 }]
            : [
                { name: 'Mountain', count: 36 },
                { name: 'Lightning Bolt', count: 24 },
              ],
        },
      },
    ],
    seed,
    maximumTurns: 40,
  };
}

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
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

async function open(subject: SessionSpec): Promise<{
  backend: NonNullable<ReturnType<typeof installedForgeBackend>>;
  session: ObservedSession;
}> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  expect(await backend.supports(subject)).toEqual([]);
  const opened = await backend.open(subject);
  if (!opened.ok) throw new Error(opened.error.message);
  return { backend, session: opened.session };
}

forgeIt(
  'accepts the trigger and moves one exact qualifying library object to hand',
  async () => {
    const running = await open(spec('z5q4-ranger-captain-search-accept', true));
    let session = running.session;
    let cast = false;
    let confirmed = false;
    let selectedOid: string | null = null;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    let completed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Ranger-Captain search decision');
        const pilot = session.view.seats[0];
        if (pilot.hand === null) throw new Error('Forge hid the local hand');
        completed =
          selectedOid !== null &&
          pilot.hand.some((card) => card.oid === selectedOid && card.name === 'Mother of Runes') &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.active}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Ranger-Captain of Eos:')) {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          confirmed = move !== undefined;
        } else if (decision.kind === 'zone-card-selection' && confirmed && selectedOid === null) {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates).not.toHaveLength(0);
          expect(candidates.every((option) => option.targets[0]?.name === 'Mother of Runes')).toBe(true);
          const choice = candidates[0];
          selectedOid = choice?.targets[0]?.oid ?? null;
          if (choice === undefined || selectedOid === null)
            throw new Error('Forge offered no exact Mother of Runes');
          await expect(session.submit('zone-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          staleSnapshot = session;
          staleMove = choice.id;
          move = choice.id;
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const untappedPlains = pilot.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          move =
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (!cast && untappedPlains >= 3
              ? decision.options.find((option) => option.text.startsWith('Ranger-Captain of Eos:'))?.id
              : undefined);
          cast ||=
            decision.options
              .find((option) => option.id === move)
              ?.text.startsWith('Ranger-Captain of Eos:') === true;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Ranger-Captain search move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }
      const evidence = `${trace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(confirmed, evidence).toBe(true);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(completed, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'declines the trigger without moving a library object',
  async () => {
    const running = await open(spec('z5q4-ranger-captain-search-decline', true));
    let session = running.session;
    let cast = false;
    let declined = false;
    let libraryBefore: number | null = null;
    let handBefore: number | null = null;
    let completed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Ranger-Captain decline decision');
        const pilot = session.view.seats[0];
        if (pilot.hand === null) throw new Error('Forge hid the local hand');
        completed =
          declined &&
          libraryBefore !== null &&
          handBefore !== null &&
          pilot.librarySize === libraryBefore &&
          pilot.hand.length === handBefore &&
          pilot.battlefield.some((card) => card.name === 'Ranger-Captain of Eos') &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.active}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Ranger-Captain of Eos:')) {
          libraryBefore = pilot.librarySize;
          handBefore = pilot.hand.length;
          move = decision.options.find((option) => option.id === 'confirm-trigger-no')?.id;
          declined = move !== undefined;
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const untappedPlains = pilot.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          move =
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (!cast && untappedPlains >= 3
              ? decision.options.find((option) => option.text.startsWith('Ranger-Captain of Eos:'))?.id
              : undefined);
          cast ||=
            decision.options
              .find((option) => option.id === move)
              ?.text.startsWith('Ranger-Captain of Eos:') === true;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Ranger-Captain decline move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(declined, evidence).toBe(true);
      expect(completed, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'sacrifices the exact source, suppresses a held Bolt for one turn, then permits it',
  async () => {
    const running = await open(spec('z5q4-ranger-captain-turn-lock', false));
    let session = running.session;
    let cast = false;
    let rangerOid: string | null = null;
    let boltOid: string | null = null;
    let activationTurn: number | null = null;
    let activated = false;
    let priorityDecisionsAfterActivation = 0;
    let blockedObserved = false;
    let boltCast = false;
    let lifeBeforeBolt: number | null = null;
    let completed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Ranger-Captain lock decision');
        const rangerPilot = session.view.seats[0];
        const spellPilot = session.view.seats[1];
        if (rangerPilot.hand === null || spellPilot.hand === null) throw new Error('Forge hid a local hand');
        rangerOid ??=
          rangerPilot.battlefield.find((card) => card.name === 'Ranger-Captain of Eos')?.oid ??
          rangerPilot.hand.find((card) => card.name === 'Ranger-Captain of Eos')?.oid ??
          null;
        boltOid ??= spellPilot.hand.find((card) => card.name === 'Lightning Bolt')?.oid ?? null;
        completed =
          activated &&
          blockedObserved &&
          boltCast &&
          rangerOid !== null &&
          boltOid !== null &&
          rangerPilot.graveyard.some((card) => card.oid === rangerOid) &&
          spellPilot.graveyard.some((card) => card.oid === boltOid) &&
          lifeBeforeBolt !== null &&
          rangerPilot.life === lifeBeforeBolt - 3 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.active}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection' && boltCast) {
          move = decision.options.find((option) => option.id === 'target-player-0')?.id;
        } else if (decision.kind === 'priority') {
          if (activated && activationTurn === session.view.turn.number) {
            priorityDecisionsAfterActivation += 1;
          }
          const ranger = rangerPilot.battlefield.find((card) => card.oid === rangerOid);
          const untappedPlains = rangerPilot.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          const untappedMountains = spellPilot.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const boltAction = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          const activate =
            decision.seat === 0 && session.view.turn.active === 1 && ranger !== undefined && !activated
              ? decision.options.find((option) => option.text.startsWith('Ranger-Captain of Eos:'))
              : undefined;
          if (
            decision.seat === 1 &&
            activated &&
            priorityDecisionsAfterActivation >= 3 &&
            activationTurn === session.view.turn.number &&
            rangerOid !== null &&
            rangerPilot.graveyard.some((card) => card.oid === rangerOid) &&
            session.view.stack.length === 0 &&
            boltOid !== null &&
            spellPilot.hand.some((card) => card.oid === boltOid) &&
            untappedMountains >= 1
          ) {
            expect(boltAction).toBeUndefined();
            blockedObserved = true;
          }
          if (
            decision.seat === 1 &&
            blockedObserved &&
            activationTurn !== null &&
            session.view.turn.number > activationTurn &&
            boltAction !== undefined &&
            !boltCast
          ) {
            lifeBeforeBolt = rangerPilot.life;
            move = boltAction.id;
            boltCast = true;
          }
          move ??=
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Plains')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            activate?.id ??
            (decision.seat === 0 && ranger === undefined && untappedPlains >= 3
              ? decision.options.find((option) => option.text.startsWith('Ranger-Captain of Eos:'))?.id
              : undefined);
          cast ||=
            decision.options
              .find((option) => option.id === move)
              ?.text.startsWith('Ranger-Captain of Eos:') === true;
          if (activate !== undefined && move === activate.id) {
            activated = true;
            activationTurn = session.view.turn.number;
          }
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Ranger-Captain lock move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(rangerOid, evidence).toMatch(/^forge-card-/u);
      expect(boltOid, evidence).toMatch(/^forge-card-/u);
      expect(activated, evidence).toBe(true);
      expect(blockedObserved, evidence).toBe(true);
      expect(boltCast, evidence).toBe(true);
      expect(completed, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  300_000,
);
