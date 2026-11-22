/** Installed-Forge outcomes for the exact optional-trigger generated-token cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function table(
  cards: SessionSpec['seats'][0]['deck']['cards'],
  seed: string,
  maximumTurns = 24,
): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Optional token pilot', controller: 'local', deck: { name: seed, cards } },
      {
        name: 'Quiet pilot',
        controller: 'engine',
        deck: { name: `${seed}-quiet`, cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed,
    maximumTurns,
  };
}

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  if (decision.kind === 'scry-move') {
    return decision.options.find((option) => option.id === 'scry-move-done')?.id;
  }
  if (decision.kind === 'scry-keep') return decision.options[0]?.id;
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

async function open(spec: SessionSpec): Promise<{
  backend: NonNullable<ReturnType<typeof installedForgeBackend>>;
  session: ObservedSession;
}> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  return { backend, session: opened.session };
}

forgeIt(
  'Emeria Angel declines one landfall and accepts the next to create one exact Bird',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Plains', count: 40 },
          { name: 'Emeria Angel', count: 20 },
        ],
        'z5q4-emeria-optional-bird',
      ),
    );
    let session = running.session;
    let confirmations = 0;
    let declined = false;
    let accepted = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Emeria Angel decision');
        const seat = session.view.seats[0];
        const angel = seat.battlefield.find((card) => card.name === 'Emeria Angel');
        const birds = seat.battlefield.filter((card) => card.name.includes('Bird'));
        declined ||= confirmations === 1 && birds.length === 0 && session.view.stack.length === 0;
        accepted ||=
          confirmations === 2 &&
          birds.length === 1 &&
          birds[0]?.power === 1 &&
          birds[0].toughness === 1 &&
          /Creature.*Bird/u.test(birds[0].typeLine) &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Emeria Angel:')) {
          move = decision.options.find((option) =>
            confirmations === 0 ? option.id === 'confirm-trigger-no' : option.id === 'confirm-trigger-yes',
          )?.id;
          confirmations += 1;
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const plains = seat.battlefield.filter((card) => card.name === 'Plains').length;
          move =
            (accepted ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (angel === undefined && plains >= 4
              ? decision.options.find((option) => option.text.startsWith('Emeria Angel:'))?.id
              : undefined);
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Emeria Angel move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(confirmations, evidence).toBe(2);
      expect(declined, evidence).toBe(true);
      expect(accepted, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  300_000,
);

forgeIt(
  'Awakening Zone declines one upkeep, then creates and sacrifices the exact Spawn for mana',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Forest', count: 35 },
          { name: 'Awakening Zone', count: 15 },
          { name: 'Acidic Slime', count: 10 },
        ],
        'z5q4-awakening-zone-optional-spawn',
      ),
    );
    let session = running.session;
    let confirmations = 0;
    let declined = false;
    let spawnOid: string | undefined;
    let spawnPaid = false;
    let slimeCast = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Awakening Zone decision');
        const seat = session.view.seats[0];
        const zone = seat.battlefield.find((card) => card.name === 'Awakening Zone');
        const spawn = seat.battlefield.find((card) => card.name.includes('Eldrazi Spawn'));
        declined ||= confirmations === 1 && spawn === undefined && session.view.stack.length === 0;
        if (confirmations === 2 && spawn !== undefined) {
          expect(spawn.power).toBe(0);
          expect(spawn.toughness).toBe(1);
          expect(spawn.typeLine).toMatch(/Creature.*Eldrazi.*Spawn/u);
          spawnOid ??= spawn.oid;
        }
        resolved ||=
          slimeCast &&
          spawnPaid &&
          spawnOid !== undefined &&
          !seat.battlefield.some((card) => card.oid === spawnOid) &&
          seat.battlefield.some((card) => card.name === 'Acidic Slime') &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Awakening Zone:')) {
          move = decision.options.find((option) =>
            confirmations === 0 ? option.id === 'confirm-trigger-no' : option.id === 'confirm-trigger-yes',
          )?.id;
          confirmations += 1;
        } else if (decision.kind === 'mana-payment') {
          const spawnSource = decision.options.find((option) =>
            option.targets.some((target) => target.oid === spawnOid),
          );
          move = !spawnPaid && spawnSource !== undefined ? spawnSource.id : routineMove(decision);
          spawnPaid ||= spawnSource !== undefined && move === spawnSource.id;
        } else if (decision.kind === 'target-selection' && slimeCast) {
          move = decision.options.find((option) => option.targets[0]?.name === 'Mountain')?.id;
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const forests = seat.battlefield.filter((card) => card.name === 'Forest').length;
          const castZone = decision.options.find((option) => option.text.startsWith('Awakening Zone:'));
          const castSlime = decision.options.find((option) => option.text.startsWith('Acidic Slime:'));
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (zone === undefined
              ? decision.options.find((option) => option.text === 'Play Forest')?.id
              : undefined) ??
            (zone === undefined && forests >= 3 ? castZone?.id : undefined) ??
            (zone !== undefined && confirmations === 1 && forests < 4
              ? decision.options.find((option) => option.text === 'Play Forest')?.id
              : undefined) ??
            (spawnOid !== undefined && !slimeCast ? castSlime?.id : undefined);
          slimeCast ||= castSlime !== undefined && move === castSlime.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Awakening Zone move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(confirmations, evidence).toBe(2);
      expect(declined, evidence).toBe(true);
      expect(spawnOid, evidence).toMatch(/^forge-card-/u);
      expect(spawnPaid, evidence).toBe(true);
      expect(resolved, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  360_000,
);

forgeIt(
  'Avenger creates one exact Plant per land, declines one landfall, then counters every Plant',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Forest', count: 40 },
          { name: 'Avenger of Zendikar', count: 20 },
        ],
        'z5q4-avenger-optional-plants',
        28,
      ),
    );
    let session = running.session;
    let initialPlantOids: readonly string[] = [];
    let confirmations = 0;
    let declined = false;
    let accepted = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Avenger decision');
        const seat = session.view.seats[0];
        const avenger = seat.battlefield.find((card) => card.name === 'Avenger of Zendikar');
        const lands = seat.battlefield.filter((card) => card.name === 'Forest');
        const plants = seat.battlefield.filter((card) => card.name.includes('Plant'));
        if (
          initialPlantOids.length === 0 &&
          avenger !== undefined &&
          plants.length === lands.length &&
          plants.length === 7 &&
          session.view.stack.length === 0
        ) {
          expect(new Set(plants.map((card) => card.oid)).size).toBe(plants.length);
          expect(plants.every((card) => /Creature.*Plant/u.test(card.typeLine))).toBe(true);
          expect(plants.every((card) => card.power === 0 && card.toughness === 1)).toBe(true);
          initialPlantOids = plants.map((card) => card.oid);
        }
        declined ||=
          confirmations === 1 &&
          initialPlantOids.length === 7 &&
          initialPlantOids.every((oid) => {
            const plant = plants.find((candidate) => candidate.oid === oid);
            return (
              plant?.power === 0 &&
              plant.toughness === 1 &&
              Object.values(plant.counters).every((count) => count === 0)
            );
          }) &&
          session.view.stack.length === 0;
        accepted ||=
          confirmations === 2 &&
          initialPlantOids.length === 7 &&
          initialPlantOids.every((oid) => {
            const plant = plants.find((candidate) => candidate.oid === oid);
            return (
              plant?.power === 1 &&
              plant.toughness === 2 &&
              Object.values(plant.counters).some((count) => count === 1)
            );
          }) &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Avenger of Zendikar:')) {
          move = decision.options.find((option) =>
            confirmations === 0 ? option.id === 'confirm-trigger-no' : option.id === 'confirm-trigger-yes',
          )?.id;
          confirmations += 1;
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const castAvenger = decision.options.find((option) =>
            option.text.startsWith('Avenger of Zendikar:'),
          );
          move =
            (accepted ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (avenger === undefined || (initialPlantOids.length === 7 && confirmations < 2)
              ? decision.options.find((option) => option.text === 'Play Forest')?.id
              : undefined) ??
            (avenger === undefined && lands.length >= 7 ? castAvenger?.id : undefined);
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Avenger move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(initialPlantOids, evidence).toHaveLength(7);
      expect(confirmations, evidence).toBe(2);
      expect(declined, evidence).toBe(true);
      expect(accepted, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  420_000,
);
